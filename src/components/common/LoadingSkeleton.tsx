export function KPISkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="card-elevated p-5 animate-pulse">
          <div className="h-3 bg-muted rounded w-20 mb-3" />
          <div className="h-7 bg-muted rounded w-24" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card-elevated p-4 animate-pulse flex gap-4">
          <div className="h-4 bg-muted rounded flex-1" />
          <div className="h-4 bg-muted rounded w-16" />
          <div className="h-4 bg-muted rounded w-16" />
          <div className="h-4 bg-muted rounded w-16" />
        </div>
      ))}
    </div>
  );
}
