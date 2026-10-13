interface Props {
  owned: number;
  total: number;
  size?: number;
}

/** Cerchio di progresso SVG: "Hai collezionato 45/879 — 5.1%" */
export default function ProgressCircle({ owned, total, size = 148 }: Props) {
  const percent = total > 0 ? (owned / total) * 100 : 0;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (percent / 100) * c;

  return (
    <div className="flex flex-col items-center gap-5 rounded-3xl border border-white/10 bg-white/10 p-5 backdrop-blur-sm min-[430px]:flex-row">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            className="stroke-white/15"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c}`}
            className="stroke-amber-300 transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-extrabold tabular-nums text-zinc-900 dark:text-white">
            {percent.toFixed(1)}%
          </span>
          <span className="text-xs text-zinc-500">
            {owned}/{total}
          </span>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Hai collezionato {owned}/{total} monete
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {owned === 0
            ? "Inizia a cliccare + sulle monete che possiedi."
            : owned === total
              ? "Collezione completa. Complimenti! 🎉"
              : "Continua così: ogni + ti avvicina al completamento."}
        </p>
        <div
          className="mt-3 h-2 w-48 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-700"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
