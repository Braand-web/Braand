// Skeleton placeholders shaped like the content they stand in for.
// Server-safe (no hooks): usable in Suspense fallbacks and client panels alike.
type Shape = "list" | "cards" | "grid" | "table" | "chart" | "document" | "rows" | "plans";

const bar = (width: string, height = 12) => <span className="ds-skeleton ds-skeleton-text" style={{width, height}}/>;

function Row({index}: {index: number}) {
 return <div className="ds-loading-row"><span className="ds-skeleton ds-loading-thumb"/><div className="ds-loading-lines">{bar(["58%", "72%", "46%", "64%", "52%"][index % 5], 13)}{bar(["34%", "28%", "40%", "30%", "36%"][index % 5], 10)}</div><span className="ds-skeleton ds-loading-pill"/></div>;
}
function CardBlock() {
 return <div className="ds-loading-card"><span className="ds-skeleton ds-loading-media"/>{bar("70%", 13)}{bar("45%", 10)}</div>;
}

export function LoadingSkeleton({label, shape = "list", count, className}: {label: string; shape?: Shape; count?: number; className?: string}) {
 const n = count ?? (shape === "grid" ? 6 : shape === "cards" || shape === "plans" ? 3 : shape === "rows" ? 3 : 4);
 let body;
 if (shape === "grid" || shape === "cards" || shape === "plans") body = <div className={"ds-loading-grid" + (shape === "plans" ? " ds-loading-plans" : "")}>{Array.from({length: n}, (_, i) => <CardBlock key={i}/>)}</div>;
 else if (shape === "chart") body = <><div className="ds-loading-kpis">{[0, 1, 2].map(i => <div key={i} className="ds-loading-card">{bar("40%", 10)}{bar("62%", 22)}</div>)}</div><span className="ds-skeleton ds-loading-chart"/></>;
 else if (shape === "document") body = <div className="ds-loading-document">{bar("52%", 20)}{["96%", "92%", "98%", "74%", "0", "94%", "88%", "60%"].map((w, i) => w === "0" ? <span key={i} className="ds-loading-gap"/> : <span key={i} className="ds-skeleton ds-skeleton-text" style={{width: w}}/>)}</div>;
 else if (shape === "rows") body = <div className="ds-loading-rows">{Array.from({length: n}, (_, i) => <div key={i} className="ds-loading-kv">{bar(["38%", "30%", "44%"][i % 3])}{bar(["22%", "18%", "26%"][i % 3])}</div>)}</div>;
 else if (shape === "table") body = <div className="ds-loading-rows">{Array.from({length: n}, (_, i) => <div key={i} className="ds-loading-kv">{bar("30%")}{bar("16%")}{bar("12%")}</div>)}</div>;
 else body = <div className="ds-loading-list">{Array.from({length: n}, (_, i) => <Row key={i} index={i}/>)}</div>;
 return <div className={"ds-loading" + (className ? " " + className : "")} role="status" aria-live="polite" aria-busy="true"><span className="ds-visually-hidden">{label}</span><div aria-hidden="true" className="ds-loading-body">{body}</div></div>;
}
