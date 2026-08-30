(function () {
  "use strict";

  const PUBLIC_FIELDS = [
    "title", "organization", "sector", "position_type", "location",
    "posted_date", "deadline", "salary", "employment_type", "posting_link",
    "source", "first_seen"
  ];
  const state = { jobs: [] };

  const byId = (id) => document.getElementById(id);
  const clean = (value) => value == null ? "" : String(value).trim();
  const normalized = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  function parseDDMMYYYY(value) {
    const match = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return null;
    const [, day, month, year] = match.map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }

  function dateValue(value) {
    const date = parseDDMMYYYY(value);
    return date ? date.getTime() : -Infinity;
  }

  function publicJob(record) {
    return Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, clean(record[field])]));
  }

  function dedupeForDisplay(records) {
    const unique = new Map();
    const externalUrls = new Map();
    const semanticJobs = new Map();
    const connectThreads = new Map();
    let nextId = 0;
    records.forEach((record) => {
      const job = publicJob(record);
      const title = normalized(job.title);
      const organization = normalized(job.organization);
      const url = clean(job.posting_link).toLowerCase();
      let isConnectUrl = false;
      try { isConnectUrl = new URL(url).hostname === "connect.informs.org"; } catch (_) { /* Empty or malformed URL. */ }
      const semanticKey = title && organization ? `text:${title}|${organization}` : "";
      const connectKey = isConnectUrl ? `connect:${url}|title:${title}` : "";
      const existingId = (!isConnectUrl && url && externalUrls.get(url)) ||
        (semanticKey && semanticJobs.get(semanticKey)) ||
        (connectKey && connectThreads.get(connectKey));
      const id = existingId || `job:${nextId++}`;
      const previous = unique.get(id);
      if (!previous || dateValue(job.posted_date) > dateValue(previous.posted_date)) unique.set(id, job);
      if (!isConnectUrl && url) externalUrls.set(url, id);
      if (semanticKey) semanticJobs.set(semanticKey, id);
      if (connectKey) connectThreads.set(connectKey, id);
    });
    return [...unique.values()];
  }

  function cell(row, label, value) {
    if (!value) return;
    const item = document.createElement("span");
    item.className = "job-meta-item";
    item.textContent = `${label}: ${value}`;
    row.appendChild(item);
  }

  function render() {
    const list = byId("jobs-list");
    const count = byId("jobs-count");
    const query = clean(byId("jobs-search").value).toLowerCase();
    const sector = byId("jobs-sector").value;
    const order = byId("jobs-sort").value;
    const searchable = ["title", "organization", "position_type", "location"];
    let jobs = state.jobs.filter((job) => {
      const matchesQuery = !query || searchable.some((field) => job[field].toLowerCase().includes(query));
      return matchesQuery && (!sector || job.sector === sector);
    });
    jobs.sort((a, b) => {
      if (order === "deadline") {
        const aDeadline = parseDDMMYYYY(a.deadline);
        const bDeadline = parseDDMMYYYY(b.deadline);
        return (aDeadline ? aDeadline.getTime() : Infinity) - (bDeadline ? bDeadline.getTime() : Infinity);
      }
      if (order === "organization") return a.organization.localeCompare(b.organization);
      if (order === "first_seen") return dateValue(b.first_seen) - dateValue(a.first_seen);
      return dateValue(b.posted_date) - dateValue(a.posted_date);
    });

    list.replaceChildren();
    count.textContent = `${jobs.length} job${jobs.length === 1 ? "" : "s"} found`;
    if (!jobs.length) {
      const empty = document.createElement("p");
      empty.className = "mb-0";
      empty.textContent = "No jobs match the current filters.";
      list.appendChild(empty);
      return;
    }
    jobs.forEach((job) => {
      const article = document.createElement("article");
      article.className = "job-card";
      const title = document.createElement(job.posting_link ? "a" : "h4");
      title.className = "job-title";
      title.textContent = job.title || "Untitled position";
      if (job.posting_link) {
        title.href = job.posting_link;
        title.target = "_blank";
        title.rel = "noopener noreferrer";
      }
      const heading = document.createElement("div");
      heading.className = "job-card-heading";
      heading.appendChild(title);
      if (job.sector) {
        const badge = document.createElement("span");
        badge.className = `job-sector job-sector-${job.sector.toLowerCase().replace(/[^a-z]+/g, "-")}`;
        badge.textContent = job.sector;
        heading.appendChild(badge);
      }
      article.appendChild(heading);
      const meta = document.createElement("div");
      meta.className = "job-meta";
      cell(meta, "Organization", job.organization);
      cell(meta, "Sector", job.sector);
      cell(meta, "Position", job.position_type);
      cell(meta, "Location", job.location);
      cell(meta, "Posted", job.posted_date);
      cell(meta, "Deadline", job.deadline);
      cell(meta, "Employment", job.employment_type);
      cell(meta, "Salary", job.salary);
      cell(meta, "Source", job.source);
      article.appendChild(meta);
      list.appendChild(article);
    });
  }

  function showStatus(message, isError) {
    const status = byId("jobs-status");
    status.textContent = message;
    status.classList.toggle("text-danger", Boolean(isError));
  }

  async function loadJobs() {
    showStatus("Loading jobs…", false);
    const fallback = Array.isArray(window.__JOB_TRACKER_DATA__) ? window.__JOB_TRACKER_DATA__ : null;
    if (location.protocol === "file:" && fallback) {
      state.jobs = dedupeForDisplay(fallback);
      showStatus("", false);
      render();
      return;
    }
    try {
      const response = await fetch("data/jobs.json", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("The local jobs file did not return a list.");
      state.jobs = dedupeForDisplay(payload.filter((item) => item && typeof item === "object"));
      showStatus("", false);
      render();
    } catch (error) {
      if (fallback) {
        state.jobs = dedupeForDisplay(fallback);
        showStatus("", false);
        render();
        return;
      }
      showStatus(`Unable to load jobs. Run the job tracker to generate data/jobs.json, then rebuild the website. ${error.message}`, true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    byId("jobs-search").addEventListener("input", render);
    ["jobs-sector", "jobs-sort"].forEach((id) => byId(id).addEventListener("change", render));
    loadJobs();
  });
}());
