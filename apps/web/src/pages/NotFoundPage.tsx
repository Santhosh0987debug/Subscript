import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { buttonClassName } from "@/components/ui/Button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function NotFoundPage() {
  useDocumentTitle("Page not found");

  return (
    <div className="flex min-h-[62vh] flex-col items-center justify-center py-12 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        404 · Off the ledger
      </p>
      <div className="relative mt-6">
        <span
          aria-hidden="true"
          className="absolute inset-x-8 bottom-2 -z-10 h-5 rounded-full bg-lime"
        />
        <h1 className="font-display text-[clamp(3rem,8vw,6rem)] leading-[0.9] tracking-[-0.05em]">
          This page slipped
          <br />
          <span className="italic">out of the ledger.</span>
        </h1>
      </div>
      <p className="mt-6 max-w-md text-sm leading-6 text-muted">
        The route does not exist yet - or perhaps it never did. The overview is
        still where the useful numbers live.
      </p>
      <Link to="/" className={buttonClassName({ className: "mt-7" })}>
        <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
        Return to overview
      </Link>
    </div>
  );
}
