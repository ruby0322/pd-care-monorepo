from __future__ import annotations

import torch
import torch.nn as nn
from torchvision import models


ARCH_CONFIGS: dict[str, dict] = {
    "baseline": {
        "stem_ch": 32,
        "stages": (64, 128, 256, 256),
        "blocks": (1, 1, 1, 1),
        "dropout": 0.4,
    },
    "wide": {
        "stem_ch": 40,
        "stages": (80, 160, 320, 320),
        "blocks": (1, 1, 1, 1),
        "dropout": 0.45,
    },
    "wide_xl": {
        "stem_ch": 48,
        "stages": (96, 192, 384, 384),
        "blocks": (1, 1, 1, 1),
        "dropout": 0.5,
    },
    "deep": {
        "stem_ch": 32,
        "stages": (64, 128, 256, 256),
        "blocks": (1, 2, 2, 2),
        "dropout": 0.35,
    },
    "lite": {
        "stem_ch": 24,
        "stages": (48, 96, 160, 160),
        "blocks": (1, 1, 1, 1),
        "dropout": 0.35,
    },
}

CLASSIFIER_HEAD_BACKBONES = {"efficientnet_b3", "mobilenet_v3_large", "convnext_tiny"}


class myBatchNorm(nn.Module):
    def __init__(self, input_channel: int, eps: float = 1e-4, momentum: float = 0.1):
        super().__init__()
        self.eps = eps
        self.momentum = momentum
        shape = (1, input_channel, 1, 1)
        self.gamma = nn.Parameter(torch.ones(shape))
        self.beta = nn.Parameter(torch.zeros(shape))
        self.moving_mean = torch.zeros(shape)
        self.moving_var = torch.ones(shape)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.moving_mean.device != x.device:
            self.moving_mean = self.moving_mean.to(x.device)
            self.moving_var = self.moving_var.to(x.device)
        y, self.moving_mean, self.moving_var = self.batch_norm(
            x,
            self.gamma,
            self.beta,
            self.moving_mean,
            self.moving_var,
            self.eps,
            self.momentum,
        )
        return y

    def batch_norm(
        self,
        x: torch.Tensor,
        gamma: torch.Tensor,
        beta: torch.Tensor,
        moving_mean: torch.Tensor,
        moving_var: torch.Tensor,
        eps: float,
        momentum: float,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        if not torch.is_grad_enabled():
            x_hat = (x - moving_mean) / torch.sqrt(moving_var + eps)
        else:
            batch_mean = torch.mean(x, dim=(0, 2, 3), keepdim=True)
            batch_var = torch.var(x, dim=(0, 2, 3), keepdim=True, unbiased=False)
            x_hat = (x - batch_mean) / torch.sqrt(batch_var + eps)
            moving_mean.data = momentum * moving_mean.data + (1.0 - momentum) * batch_mean.data
            moving_var.data = momentum * moving_var.data + (1.0 - momentum) * batch_var.data
        y = gamma * x_hat + beta
        return y, moving_mean, moving_var


class myConvolution(nn.Module):
    def __init__(
        self,
        input_channel: int,
        output_channel: int,
        kernel_size: int = 1,
        stride: int = 1,
        padding: int = 0,
    ):
        super().__init__()
        self.conv = nn.Conv2d(input_channel, output_channel, kernel_size, stride, padding)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv(x)


class myActivation(nn.Module):
    def __init__(self):
        super().__init__()
        self.act = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(x)


class myMaxPooling(nn.Module):
    def __init__(self, kernel_size: int = 2, stride: int = 2, padding: int = 0):
        super().__init__()
        self.pool = nn.MaxPool2d(kernel_size, stride, padding)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.pool(x)


class myAvgPooling(nn.Module):
    def __init__(self, kernel_size: int = 2, stride: int = 2, padding: int = 0):
        super().__init__()
        self.pool = nn.AvgPool2d(kernel_size, stride, padding)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.pool(x)


class myResBlock(nn.Module):
    def __init__(self, input_channel: int, med_channel: int, stride: int = 1, padding: int = 1):
        super().__init__()
        self.conv1 = myConvolution(input_channel, med_channel, kernel_size=3, stride=stride, padding=padding)
        self.bn1 = myBatchNorm(med_channel)
        self.relu = myActivation()
        self.conv2 = myConvolution(med_channel, med_channel, kernel_size=3, stride=1, padding=padding)
        self.bn2 = myBatchNorm(med_channel)
        self.shortcut = nn.Sequential()
        if stride != 1 or input_channel != med_channel:
            self.shortcut = nn.Sequential(
                myConvolution(input_channel, med_channel, kernel_size=1, stride=stride),
                myBatchNorm(med_channel),
            )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        identity = self.shortcut(x)
        out = self.conv1(x)
        out = self.bn1(out)
        out = self.relu(out)
        out = self.conv2(out)
        out = self.bn2(out)
        out += identity
        out = self.relu(out)
        return out


def _make_stage(in_ch: int, out_ch: int, n_blocks: int) -> nn.Module:
    layers: list[nn.Module] = [myResBlock(in_ch, out_ch)]
    for _ in range(n_blocks - 1):
        layers.append(myResBlock(out_ch, out_ch))
    return nn.Sequential(*layers)


class myCNN(nn.Module):
    def __init__(self, input_channel: int = 3, num_classes: int = 5, arch: str = "baseline"):
        super().__init__()
        if arch not in ARCH_CONFIGS:
            raise ValueError(f"Unknown arch {arch!r}; choose from {list(ARCH_CONFIGS)}")
        cfg = ARCH_CONFIGS[arch]
        stem_ch = cfg["stem_ch"]
        stages: tuple[int, int, int, int] = cfg["stages"]
        blocks: tuple[int, int, int, int] = cfg["blocks"]
        dropout_p = cfg["dropout"]

        self.stem = nn.Sequential(
            myConvolution(input_channel, stem_ch, kernel_size=7, stride=2, padding=3),
            myBatchNorm(stem_ch),
            myActivation(),
            myMaxPooling(kernel_size=3, stride=2, padding=1),
        )
        s1, s2, s3, s4 = stages
        b1, b2, b3, b4 = blocks
        self.stage1 = _make_stage(stem_ch, s1, b1)
        self.pool1 = myMaxPooling(2, 2)
        self.stage2 = _make_stage(s1, s2, b2)
        self.pool2 = myMaxPooling(2, 2)
        self.stage3 = _make_stage(s2, s3, b3)
        self.pool3 = myMaxPooling(2, 2)
        self.stage4 = _make_stage(s3, s4, b4)
        self.global_pool = nn.AdaptiveAvgPool2d(1)
        self.dropout = nn.Dropout(p=dropout_p)
        self.classifier = nn.Linear(s4, num_classes)
        self._arch_name = arch

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.stem(x)
        x = self.pool1(self.stage1(x))
        x = self.pool2(self.stage2(x))
        x = self.pool3(self.stage3(x))
        x = self.stage4(x)
        x = self.global_pool(x)
        x = torch.flatten(x, 1)
        x = self.dropout(x)
        x = self.classifier(x)
        return x


class EvalTTAWrapper(nn.Module):
    def __init__(self, model: nn.Module, *, hflip: bool = False):
        super().__init__()
        self.model = model
        self.hflip = hflip

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        logits = self.model(x)
        if self.training or not self.hflip:
            return logits
        flipped_logits = self.model(torch.flip(x, dims=[3]))
        return 0.5 * (logits + flipped_logits)


def build_transfer_model(backbone: str, num_classes: int, dropout_p: float) -> nn.Module:
    if backbone == "resnet50":
        base = models.resnet50(weights=None)
        in_features = base.fc.in_features
        base.fc = nn.Sequential(
            nn.Dropout(p=dropout_p),
            nn.Linear(in_features, num_classes),
        )
        return base

    if backbone == "efficientnet_b3":
        base = models.efficientnet_b3(weights=None)
        in_features = base.classifier[1].in_features
        base.classifier = nn.Sequential(
            nn.Dropout(p=dropout_p, inplace=True),
            nn.Linear(in_features, num_classes),
        )
        return base

    if backbone == "mobilenet_v3_large":
        base = models.mobilenet_v3_large(weights=None)
        in_features = base.classifier[-1].in_features
        base.classifier[-2] = nn.Dropout(p=dropout_p, inplace=True)
        base.classifier[-1] = nn.Linear(in_features, num_classes)
        return base

    if backbone == "convnext_tiny":
        base = models.convnext_tiny(weights=None)
        in_features = base.classifier[-1].in_features
        base.classifier = nn.Sequential(
            base.classifier[0],
            base.classifier[1],
            nn.Dropout(p=dropout_p, inplace=True),
            nn.Linear(in_features, num_classes),
        )
        return base

    raise ValueError(f"Unsupported backbone {backbone!r}")


COMPAT_EXPORTS = {
    "ARCH_CONFIGS": ARCH_CONFIGS,
    "CLASSIFIER_HEAD_BACKBONES": CLASSIFIER_HEAD_BACKBONES,
    "EvalTTAWrapper": EvalTTAWrapper,
    "build_transfer_model": build_transfer_model,
    "myActivation": myActivation,
    "myAvgPooling": myAvgPooling,
    "myBatchNorm": myBatchNorm,
    "myCNN": myCNN,
    "myConvolution": myConvolution,
    "myMaxPooling": myMaxPooling,
    "myResBlock": myResBlock,
}

