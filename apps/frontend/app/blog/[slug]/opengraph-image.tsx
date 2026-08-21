import { ImageResponse } from "next/og";

import { getPostBySlug } from "@/lib/blog/posts";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

type ImageProps = {
  params: Promise<{ slug: string }>;
};

export default async function OpenGraphImage({ params }: ImageProps) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  const title = post?.title ?? "最新消息";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#fafafa",
          padding: "72px",
        }}
      >
        <div style={{ fontSize: 28, color: "#52525b", fontWeight: 600 }}>PD Care 最新消息</div>
        <div style={{ fontSize: 56, color: "#18181b", fontWeight: 700, lineHeight: 1.2 }}>{title}</div>
        <div style={{ fontSize: 24, color: "#71717a" }}>{post?.author ?? "臺大醫院 PD Care 團隊"}</div>
      </div>
    ),
    size
  );
}
