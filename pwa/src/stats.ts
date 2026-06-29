import { fetchStats } from "./api";
import { errorMessage } from "./helpers";

export async function renderStats(root: HTMLElement): Promise<void> {
	root.innerHTML = `<div id="stats-area" class="card-area">Loading stats…</div>`;

	const area = root.querySelector<HTMLElement>("#stats-area");
	if (!area) return;

	try {
		const s = await fetchStats();
		const retention = s.todayRetention !== null ? `${Math.round(s.todayRetention * 100)}%` : "—";
		area.innerHTML = `
			<div class="stats-grid">
				<div class="stat-card">
					<span class="stat-value">${s.todayReviews}</span>
					<span class="stat-label">Today's Reviews</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${s.streak} 🔥</span>
					<span class="stat-label">Streak (days)</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${retention}</span>
					<span class="stat-label">Today Retention</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${s.totalCards}</span>
					<span class="stat-label">Total Cards</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${s.newCards}</span>
					<span class="stat-label">New</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${s.learningCards}</span>
					<span class="stat-label">Learning</span>
				</div>
				<div class="stat-card">
					<span class="stat-value">${s.reviewCards}</span>
					<span class="stat-label">Review</span>
				</div>
			</div>
		`;
	} catch (err) {
		area.textContent = `Failed to load stats: ${errorMessage(err)}`;
	}
}
