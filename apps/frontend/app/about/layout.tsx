import { BlogHeader } from "@/components/blog/blog-header";

export default function AboutLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <BlogHeader />
      {children}
    </div>
  );
}
