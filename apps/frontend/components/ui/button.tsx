import * as React from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "destructive";
type ButtonSize = "default" | "sm";

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-zinc-900 text-white hover:bg-zinc-800",
  outline: "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
  destructive: "border border-red-200 bg-white text-red-600 hover:bg-red-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 px-3 py-1.5 text-xs",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-lg transition-colors disabled:pointer-events-none disabled:opacity-50",
          variantClasses[variant],
          sizeClasses[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
