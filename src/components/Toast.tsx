import { AlertCircle, CheckCircle2 } from "lucide-react";

export interface Notice {
  kind: "info" | "error";
  text: string;
}

interface ToastProps {
  notice: Notice;
}

export function Toast({ notice }: ToastProps) {
  const isError = notice.kind === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center">
      <div
        role="status"
        className={`wb-animate-in flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-[12px] font-medium shadow-lg backdrop-blur-xl ${
          isError
            ? "border-red-200/80 bg-red-50/90 text-red-700"
            : "border-neutral-200/80 bg-white/90 text-neutral-700"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        <span>{notice.text}</span>
      </div>
    </div>
  );
}
