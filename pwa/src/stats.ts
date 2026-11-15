import { type ActivityDay, fetchActivity, fetchStats } from "./api";
import { escapeHtml } from "./dom";
import { errorMessage } from "./helpers";
import { showToast } from "./ui";

interface GraphCell {
	date: string | null;
	count: number;
	level: number;
}

interface GraphWeek {
	cells: GraphCell[]; // length 7, Sun..Sat
	label: string | null; // month label for this column, if it changed
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function dayOfWeek(dateKey: string): number {
	// Calendar day-of-week from a YYYY-MM-DD date, independent of host timezone.
	return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

function monthOf(dateKey: string): number {
	return new Date(`${dateKey}T00:00:00Z`).getUTCMonth();
}

function levelFor(count: number, max: number): number {
	if (count <= 0) return 0;
	if (max <= 0) return 0;
	if (count <= max * 0.25) return 1;
	if (count <= max * 0.5) return 2;
	if (count <= max * 0.75) return 3;
	return 4;
}

function buildGraph(days: ActivityDay[]): GraphWeek[] {
	if (days.length === 0) return [];
	const max = days.reduce((m, d) => Math.max(m, d.count), 0);
	const first = days[0];
	const leadPadding = dayOfWeek(first.date); // empty cells before first day in its week

	const padded: (ActivityDay | null)[] = [];
	for (let i = 0; i < leadPadding; i++) padded.push(null);
	for (const d of days) padded.push(d);
	// pad trailing to complete the final week
	while (padded.length % 7 !== 0) padded.push(null);

	const weeks: GraphWeek[] = [];
	let lastMonth = -1;
	for (let i = 0; i < padded.length; i += 7) {
		const slice = padded.slice(i, i + 7);
		const firstReal = slice.find((c): c is ActivityDay => c !== null);
		const month = firstReal ? monthOf(firstReal.date) : lastMonth;
		const label = firstReal && month !== lastMonth ? MONTH_LABELS[month] : null;
		if (firstReal) lastMonth = month;
		weeks.push({
			label,
			cells: slice.map((c) =>
				c === null
					? { date: null, count: 0, level: 0 }
					: { date: c.date, count: c.count, level: levelFor(c.count, max) },
			),
		});
	}
	return weeks;
}

function scrollActivityToLatest(root: HTMLElement): void {
	const scroller = root.querySelector<HTMLElement>(".contrib-scroll");
	if (!scroller) return;
	const scroll = () => {
		scroller.scrollLeft = scroller.scrollWidth;
	};
	if (typeof requestAnimationFrame === "function") {
		requestAnimationFrame(scroll);
	} else {
		scroll();
	}
}

function renderActivityGraph(days: ActivityDay[], total: number): string {
	if (days.length === 0) return "";
	const weeks = buildGraph(days);
	const monthHeader = weeks
		.map((w) => `<span class="contrib-month-label">${w.label ? escapeHtml(w.label) : ""}</span>`)
		.join("");
	const weekdayCol = WEEKDAY_LABELS.map(
		(d, i) =>
			`<span class="contrib-weekday-label">${i === 1 || i === 3 || i === 5 ? escapeHtml(d) : ""}</span>`,
	).join("");
	const grid = weeks
		.map(
			(w) =>
				`<div class="contrib-week">${w.cells
					.map((c) => {
						if (c.date === null) {
							return `<span class="contrib-cell contrib-empty"></span>`;
						}
						const label = `${c.count} review${c.count === 1 ? "" : "s"} on ${c.date}`;
						return `<span class="contrib-cell contrib-l${c.level}" title="${escapeHtml(
							label,
						)}" data-date="${escapeHtml(c.date)}" data-count="${c.count}"></span>`;
					})
					.join("")}</div>`,
		)
		.join("");
	const lastDate = days[days.length - 1]?.date ?? "";
	return `
		<section class="contrib-card" aria-label="Review activity">
			<div class="contrib-header">
				<span class="contrib-total">${total} review${total === 1 ? "" : "s"} in the last year</span>
				<span class="contrib-range">${escapeHtml(days[0]?.date ?? "")} – ${escapeHtml(
					lastDate,
				)}</span>
			</div>
			<div class="contrib-scroll">
				<div class="contrib-month-row">${monthHeader}</div>
				<div class="contrib-body">
					<div class="contrib-weekday-col">${weekdayCol}</div>
					<div class="contrib-grid">${grid}</div>
				</div>
			</div>
			<div class="contrib-legend">
				<span>Less</span>
				<span class="contrib-cell contrib-l0"></span>
				<span class="contrib-cell contrib-l1"></span>
				<span class="contrib-cell contrib-l2"></span>
				<span class="contrib-cell contrib-l3"></span>
				<span class="contrib-cell contrib-l4"></span>
				<span>More</span>
			</div>
		</section>
	`;
}

export async function renderStats(root: HTMLElement): Promise<void> {
	root.innerHTML = `
		<div class="stats-page">
			<section class="page-hero stats-hero" aria-labelledby="stats-title">
				<div class="page-kicker">Progress Snapshot</div>
				<h2 id="stats-title">Your memory practice at a glance</h2>
				<p class="hint">Track today's rhythm, retention, and the shape of your deck.</p>
			</section>
			<div id="stats-area" class="stats-area">
				<div class="stats-grid" aria-hidden="true">
					${Array.from({ length: 6 })
						.map(
							() => `
						<div class="stat-card stat-card-skeleton">
							<div class="skeleton-line skeleton-line-value"></div>
							<div class="skeleton-line skeleton-line-sm"></div>
						</div>`,
						)
						.join("")}
				</div>
				<span class="visually-hidden">Loading stats…</span>
			</div>
		</div>
	`;

	const area = root.querySelector<HTMLElement>("#stats-area");
	if (!area) return;

	try {
		const [s, activity] = await Promise.all([fetchStats(), fetchActivity(365).catch(() => null)]);
		const retention = s.todayRetention !== null ? `${Math.round(s.todayRetention * 100)}%` : "—";
		const fmt = (value: number): string => value.toLocaleString("en-US");
		area.innerHTML = `
			<div class="stats-grid">
				<div class="stat-card">
					<span class="stat-value">${fmt(s.todayReviews)}</span>
					<span class="stat-label">Today's Reviews</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${fmt(s.streak)}<span class="stat-flame" aria-hidden="true">🔥</span></span>
					<span class="stat-label">Streak (days)</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${retention}</span>
					<span class="stat-label" title="Share of today's reviews rated Good or Easy">Retention today</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${fmt(s.totalCards)}</span>
					<span class="stat-label">Total Cards</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${fmt(s.newCards)}</span>
					<span class="stat-label">New</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${fmt(s.learningCards)}</span>
					<span class="stat-label">Learning</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${fmt(s.reviewCards)}</span>
					<span class="stat-label">Review</span>
				</div>
			</div>
			<p class="stats-footnote">Retention counts today's reviews you rated Good or Easy.</p>
			${activity ? renderActivityGraph(activity.days, activity.total) : ""}
		`;
		// Heatmap cells are 11px; on touch the hover title is unreachable, so a
		// tap surfaces the same information as a toast.
		const grid = area.querySelector(".contrib-grid");
		grid?.addEventListener("click", (event) => {
			const cell = (event.target as HTMLElement | null)?.closest<HTMLElement>(
				".contrib-cell[data-date]",
			);
			if (!cell?.dataset.date) return;
			const count = Number(cell.dataset.count ?? 0);
			showToast({
				message: `${count} review${count === 1 ? "" : "s"} on ${cell.dataset.date}`,
				duration: 2200,
			});
		});
		if (activity) scrollActivityToLatest(area);
	} catch (err) {
		area.innerHTML = `
			<div class="state-block" role="status">
				<div class="state-icon" aria-hidden="true">📊</div>
				<div class="state-title">Stats unavailable</div>
				<p class="state-hint">${escapeHtml(`Failed to load stats: ${errorMessage(err)}`)}</p>
				<button id="stats-retry-btn" class="secondary" type="button">Try again</button>
			</div>
		`;
		area.querySelector("#stats-retry-btn")?.addEventListener("click", () => {
			renderStats(root);
		});
	}
}
