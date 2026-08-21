import type { MDXComponents } from "mdx/types";
import Image from "next/image";

export const blogMdxComponents: MDXComponents = {
  h2: (props) => <h2 className="mt-10 text-xl font-semibold leading-snug text-zinc-900" {...props} />,
  h3: (props) => <h3 className="mt-8 text-lg font-semibold leading-snug text-zinc-900" {...props} />,
  p: (props) => <p className="mt-4 text-lg leading-8 text-zinc-700" {...props} />,
  ol: (props) => <ol className="mt-4 list-decimal space-y-3 pl-6 text-lg leading-8 text-zinc-700" {...props} />,
  ul: (props) => <ul className="mt-4 list-disc space-y-3 pl-6 text-lg leading-8 text-zinc-700" {...props} />,
  li: (props) => <li className="leading-8" {...props} />,
  a: (props) => {
    const href = typeof props.href === "string" ? props.href : "";
    const isExternal = /^https?:\/\//.test(href);
    return (
      <a
        className="underline underline-offset-4"
        {...props}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      />
    );
  },
  img: (props) => {
    const src = typeof props.src === "string" ? props.src : "";
    const alt = typeof props.alt === "string" ? props.alt : "";
    if (!src) {
      return null;
    }
    return (
      <span className="mt-4 block overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
        <Image src={src} alt={alt} width={390} height={844} unoptimized className="h-auto w-full" />
        {alt ? <span className="block px-3 py-2 text-sm leading-6 text-zinc-500">{alt}</span> : null}
      </span>
    );
  },
};
