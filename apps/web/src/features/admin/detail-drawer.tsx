"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";

interface DetailDrawerProps {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const focusable = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function DetailDrawer({ title, description, open, onClose, children, footer }: DetailDrawerProps) {
  const panel = useRef<HTMLElement>(null);
  const closeHandler = useRef(onClose);
  const headingId = useId();

  useEffect(() => { closeHandler.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") { event.preventDefault(); closeHandler.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const elements = Array.from(panel.current.querySelectorAll<HTMLElement>(focusable));
      if (elements.length === 0) { event.preventDefault(); return; }
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const frame = window.requestAnimationFrame(() => panel.current?.focus());
    document.body.classList.add("drawer-open");
    document.addEventListener("keydown", onKeyDown);
    return () => { window.cancelAnimationFrame(frame); document.body.classList.remove("drawer-open"); document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [open]);

  if (!open) return null;
  return <div className="detail-drawer" role="presentation"><button className="detail-drawer__overlay" type="button" aria-label="Zatvori detalje" onClick={onClose} /><aside ref={panel} className="detail-drawer__panel" role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}><header className="detail-drawer__header"><div><p className="eyebrow">DETALJI ZAPISA</p><h2 id={headingId}>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="detail-drawer__close" aria-label="Zatvori detalje" onClick={onClose}>×</button></header><div className="detail-drawer__content">{children}</div>{footer && <footer className="detail-drawer__footer">{footer}</footer>}</aside></div>;
}
