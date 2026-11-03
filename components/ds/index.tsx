"use client";
// Braand design system: accessible, token-based building blocks (see ds.css).
import {createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes} from "react";
import {AlertCircle, Check, CheckCircle2, Info, X} from "lucide-react";

const cx = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(" ");

/* Spinner */
export function Spinner({size = "md", label = "Chargement", className}: {size?: "md" | "lg"; label?: string; className?: string}) {
 return <span role="status" aria-label={label} className={cx("ds-spinner", size === "lg" && "ds-spinner-lg", className)}/>;
}

/* Button */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode; iconOnly?: boolean; block?: boolean};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({variant = "secondary", size = "md", loading = false, icon, iconOnly = false, block = false, className, children, disabled, type = "button", ...rest}, ref) {
 return <button ref={ref} type={type} className={cx("ds-btn", `ds-btn-${variant}`, size !== "md" && `ds-btn-${size}`, iconOnly && "ds-btn-icon", block && "ds-btn-block", className)} disabled={disabled || loading} aria-busy={loading || undefined} data-loading={loading || undefined} {...rest}>
  {loading && <span className="ds-spinner" aria-hidden="true"/>}
  {icon}{iconOnly ? <span className="ds-visually-hidden">{children}</span> : children}
 </button>;
});

/* Field wrapper shared by Input, Textarea and Select */
function useField(id: string | undefined, hint?: ReactNode, error?: ReactNode) {
 const generated = useId(), fieldId = id || generated;
 const describedBy = [hint ? fieldId + "-hint" : "", error ? fieldId + "-error" : ""].filter(Boolean).join(" ") || undefined;
 return {fieldId, describedBy};
}
function Field({id, label, hint, error, children}: {id: string; label?: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode}) {
 return <div className="ds-field">
  {label && <label className="ds-field-label" htmlFor={id}>{label}</label>}
  {children}
  {hint && !error && <span id={id + "-hint"} className="ds-field-hint">{hint}</span>}
  {error && <span id={id + "-error"} className="ds-field-error" role="alert"><AlertCircle size={14} aria-hidden="true"/>{error}</span>}
 </div>;
}
type FieldProps = {label?: ReactNode; hint?: ReactNode; error?: ReactNode};
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input({label, hint, error, id, className, ...rest}, ref) {
 const {fieldId, describedBy} = useField(id, hint, error);
 return <Field id={fieldId} label={label} hint={hint} error={error}><input ref={ref} id={fieldId} className={cx("ds-field-control", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}/></Field>;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(function Textarea({label, hint, error, id, className, ...rest}, ref) {
 const {fieldId, describedBy} = useField(id, hint, error);
 return <Field id={fieldId} label={label} hint={hint} error={error}><textarea ref={ref} id={fieldId} className={cx("ds-field-control", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}/></Field>;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps>(function Select({label, hint, error, id, className, children, ...rest}, ref) {
 const {fieldId, describedBy} = useField(id, hint, error);
 return <Field id={fieldId} label={label} hint={hint} error={error}><select ref={ref} id={fieldId} className={cx("ds-field-control", className)} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest}>{children}</select></Field>;
});

/* Checkbox & Switch */
export function Checkbox({label, className, ...rest}: InputHTMLAttributes<HTMLInputElement> & {label: ReactNode}) {
 return <label className={cx("ds-check", className)}><input type="checkbox" {...rest}/><span className="ds-check-box" aria-hidden="true"><Check strokeWidth={3}/></span><span>{label}</span></label>;
}
export function Switch({label, className, ...rest}: InputHTMLAttributes<HTMLInputElement> & {label: ReactNode}) {
 return <label className={cx("ds-switch", className)}><input type="checkbox" role="switch" {...rest}/><span className="ds-switch-track" aria-hidden="true"/><span>{label}</span></label>;
}

/* Card, Badge, Avatar, Skeleton */
export function Card({interactive = false, className, children, ...rest}: React.HTMLAttributes<HTMLDivElement> & {interactive?: boolean}) {
 return <div className={cx("ds-card", interactive && "ds-card-interactive", className)} tabIndex={interactive ? 0 : undefined} {...rest}>{children}</div>;
}
export function Badge({tone = "neutral", children}: {tone?: "neutral" | "success" | "warning" | "danger" | "accent"; children: ReactNode}) {
 return <span className={cx("ds-badge", tone !== "neutral" && `ds-badge-${tone}`)}>{children}</span>;
}
export function Avatar({name, src, size = "md"}: {name: string; src?: string; size?: "sm" | "md" | "lg"}) {
 const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("") || "?";
 // eslint-disable-next-line @next/next/no-img-element
 return <span className={cx("ds-avatar", size !== "md" && `ds-avatar-${size}`)} aria-label={name} role="img">{src ? <img src={src} alt=""/> : initials}</span>;
}
export function Skeleton({variant = "text", width, height, className}: {variant?: "text" | "title" | "circle" | "block"; width?: number | string; height?: number | string; className?: string}) {
 return <span aria-hidden="true" className={cx("ds-skeleton", variant === "text" && "ds-skeleton-text", variant === "title" && "ds-skeleton-title", variant === "circle" && "ds-skeleton-circle", className)} style={{width, height}}/>;
}

/* Empty state */
export function EmptyState({icon, title, description, actions}: {icon?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode}) {
 return <section className="ds-empty" aria-label={typeof title === "string" ? title : undefined}>
  {icon && <span className="ds-empty-icon" aria-hidden="true">{icon}</span>}
  <h2 className="ds-empty-title">{title}</h2>
  {description && <p className="ds-empty-text">{description}</p>}
  {actions && <div className="ds-empty-actions">{actions}</div>}
 </section>;
}

/* Tabs: roving focus with arrow keys, Home and End */
export function Tabs({items, value, onChange, label}: {items: {id: string; label: ReactNode}[]; value: string; onChange: (id: string) => void; label: string}) {
 const refs = useRef<(HTMLButtonElement | null)[]>([]);
 const move = (event: KeyboardEvent, index: number) => {
  const last = items.length - 1, next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
  if (next < 0) return; event.preventDefault(); refs.current[next]?.focus(); onChange(items[next].id);
 };
 return <div className="ds-tabs" role="tablist" aria-label={label}>{items.map((item, index) => <button key={item.id} ref={element => {refs.current[index] = element;}} type="button" role="tab" className="ds-tab" aria-selected={item.id === value} tabIndex={item.id === value ? 0 : -1} onClick={() => onChange(item.id)} onKeyDown={event => move(event, index)}>{item.label}</button>)}</div>;
}

/* Tooltip */
export function Tooltip({content, children}: {content: string; children: ReactNode}) {
 const id = useId();
 return <span className="ds-tooltip" aria-describedby={id}>{children}<span id={id} role="tooltip" className="ds-tooltip-bubble">{content}</span></span>;
}

/* Modal & Drawer on native <dialog>: focus trap, Escape and backdrop close */
function Dialog({open, onClose, title, children, footer, kind}: {open: boolean; onClose: () => void; title: ReactNode; children?: ReactNode; footer?: ReactNode; kind: "modal" | "drawer"}) {
 const ref = useRef<HTMLDialogElement>(null), titleId = useId();
 useEffect(() => {const dialog = ref.current; if (!dialog) return; if (open && !dialog.open) dialog.showModal(); if (!open && dialog.open) dialog.close();}, [open]);
 return <dialog ref={ref} className={kind === "modal" ? "ds-modal" : "ds-drawer"} aria-labelledby={titleId} onCancel={event => {event.preventDefault(); onClose();}} onClick={event => {if (event.target === ref.current) onClose();}}>
  <header className="ds-dialog-header"><h2 id={titleId} className="ds-dialog-title">{title}</h2><Button variant="ghost" iconOnly icon={<X size={18} aria-hidden="true"/>} onClick={onClose}>Fermer</Button></header>
  <div className="ds-dialog-body">{children}</div>
  {footer && <footer className="ds-dialog-footer">{footer}</footer>}
 </dialog>;
}
export const Modal = (props: Omit<Parameters<typeof Dialog>[0], "kind">) => <Dialog {...props} kind="modal"/>;
export const Drawer = (props: Omit<Parameters<typeof Dialog>[0], "kind">) => <Dialog {...props} kind="drawer"/>;

/* Toasts: polite live region, auto-dismiss, manual close */
type Toast = {id: number; message: ReactNode; tone: "info" | "success" | "danger"};
const ToastContext = createContext<(message: ReactNode, tone?: Toast["tone"]) => void>(() => undefined);
export function ToastProvider({children}: {children: ReactNode}) {
 const [toasts, setToasts] = useState<Toast[]>([]), counter = useRef(0);
 const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), []);
 const show = useCallback((message: ReactNode, tone: Toast["tone"] = "info") => {const id = ++counter.current; setToasts(current => [...current.slice(-2), {id, message, tone}]); setTimeout(() => dismiss(id), 4500);}, [dismiss]);
 const value = useMemo(() => show, [show]);
 return <ToastContext.Provider value={value}>{children}<div className="ds-toaster" role="region" aria-label="Notifications" aria-live="polite">{toasts.map(toast => <div key={toast.id} className="ds-toast" data-tone={toast.tone}>{toast.tone === "success" ? <CheckCircle2 size={18} aria-hidden="true"/> : toast.tone === "danger" ? <AlertCircle size={18} aria-hidden="true"/> : <Info size={18} aria-hidden="true"/>}<span className="ds-toast-message">{toast.message}</span><Button size="sm" variant="ghost" iconOnly icon={<X size={14} aria-hidden="true"/>} onClick={() => dismiss(toast.id)}>Fermer la notification</Button></div>)}</div></ToastContext.Provider>;
}
export const useToast = () => useContext(ToastContext);

/* Navbar & Sidebar layout primitives */
export function Navbar({children, label = "Navigation"}: {children: ReactNode; label?: string}) {return <header className="ds-navbar" aria-label={label}>{children}</header>;}
export function Sidebar({children, label = "Navigation principale"}: {children: ReactNode; label?: string}) {return <nav className="ds-sidebar" aria-label={label}>{children}</nav>;}
export function SidebarItem({icon, children, current = false, onClick}: {icon?: ReactNode; children: ReactNode; current?: boolean; onClick?: () => void}) {
 return <button type="button" className="ds-sidebar-item" aria-current={current ? "page" : undefined} onClick={onClick}>{icon}{children}</button>;
}
