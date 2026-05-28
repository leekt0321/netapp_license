const logInput = document.querySelector("#logInput");
const sampleButton = document.querySelector("#sampleButton");
const clearButton = document.querySelector("#clearButton");
const logFileInput = document.querySelector("#logFileInput");
const serialCards = document.querySelector("#serialCards");
const emptyState = document.querySelector("#emptyState");
const compareSection = document.querySelector("#compareSection");
const matrixSection = document.querySelector("#matrixSection");
const matrixTable = document.querySelector("#licenseMatrix");
const parseStatus = document.querySelector("#parseStatus");
const filterPanel = document.querySelector("#filterPanel");
const searchInput = document.querySelector("#searchInput");
const ownerStatusFilter = document.querySelector("#ownerStatusFilter");
const ownerFilter = document.querySelector("#ownerFilter");
const serialFilter = document.querySelector("#serialFilter");
const licenseFilter = document.querySelector("#licenseFilter");
const resetFiltersButton = document.querySelector("#resetFiltersButton");
const exportExcelButton = document.querySelector("#exportExcelButton");
const baselineSelect = document.querySelector("#baselineSelect");
const targetSelect = document.querySelector("#targetSelect");
const compareButton = document.querySelector("#compareButton");
const compareOutput = document.querySelector("#compareOutput");

const counters = {
  serials: document.querySelector("#serialCount"),
  ownerNone: document.querySelector("#ownerNoneCount"),
  ownerAssigned: document.querySelector("#ownerAssignedCount"),
  licenses: document.querySelector("#licenseCount"),
};

const parserState = {
  logText: null,
  records: [],
  visibleRecords: [],
  visibleLicenses: [],
};

let renderTimer = null;

const sampleLog = `dcissd01::> lics ense show
  (system license show)

Serial Number: 1-81-0000000000000452031000042
Owner: none
Installed License: Legacy Key
Capacity: -
Package           Type     Description           Expiration
----------------- -------- --------------------- -------------------
NFS               license  NFS License           -
CIFS              license  CIFS License          -
iSCSI             license  iSCSI License         -
FCP               license  FCP License           -
FlexClone         license  FlexClone License     -
TPM               license  Trusted Platform Module License -
VE                license  Volume Encryption License -

Serial Number: 952252001305
Owner: node-01
Installed License: Legacy Key
Capacity: -
Package           Type     Description           Expiration
----------------- -------- --------------------- -------------------
NFS               license  NFS License           -
CIFS              license  CIFS License          -
iSCSI             license  iSCSI License         -`;

function normalizeSerial(rawSerial) {
  const serial = rawSerial.trim();
  if (!serial.includes("-")) {
    return serial;
  }

  const tail = serial.split("-").pop() ?? serial;
  const withoutLeadingZeros = tail.replace(/^0+/, "");
  return withoutLeadingZeros || tail;
}

function parseLicenseShow(logText) {
  const lines = logText.replace(/\r\n?/g, "\n").split("\n");
  const markerIndexes = [];

  lines.forEach((line, index) => {
    if (line.trim().toLowerCase() === "(system license show)") {
      markerIndexes.push(index);
    }
  });

  const records = [];

  markerIndexes.forEach((markerIndex, markerPosition) => {
    const nextMarker = markerIndexes[markerPosition + 1] ?? lines.length;
    const sectionLines = lines.slice(markerIndex + 1, nextMarker);
    let current = null;
    let inPackageTable = false;

    sectionLines.forEach((line) => {
      const trimmed = line.trim();
      const serialMatch = trimmed.match(/^Serial Number:\s*(.+)$/i);
      const ownerMatch = trimmed.match(/^Owner:\s*(.+)$/i);

      if (serialMatch) {
        if (current) {
          records.push(current);
        }

        const rawSerial = serialMatch[1].trim();
        current = {
          rawSerial,
          serial: normalizeSerial(rawSerial),
          owner: "",
          licenses: [],
          sourceMarkerLine: markerIndex + 1,
        };
        inPackageTable = false;
        return;
      }

      if (!current) {
        return;
      }

      if (ownerMatch) {
        current.owner = ownerMatch[1].trim();
        return;
      }

      if (/^Package\s+Type\s+Description\s+Expiration/i.test(trimmed)) {
        inPackageTable = true;
        return;
      }

      if (!inPackageTable || !trimmed || /^-+\s+-+/.test(trimmed)) {
        return;
      }

      if (/^\d+\s+entries?\s+were\s+displayed\.?$/i.test(trimmed)) {
        inPackageTable = false;
        return;
      }

      if (/::>\s*/.test(trimmed) || /^[A-Za-z][\w-]*::>/.test(trimmed)) {
        inPackageTable = false;
        return;
      }

      const licenseMatch = trimmed.match(/^(\S+)\s+\S+\s+/);
      if (licenseMatch) {
        const licenseName = licenseMatch[1].trim();
        if (!current.licenses.includes(licenseName)) {
          current.licenses.push(licenseName);
        }
      }
    });

    if (current) {
      records.push(current);
    }
  });

  return mergeSerialRecords(records);
}

function mergeSerialRecords(records) {
  const merged = new Map();

  records.forEach((record) => {
    const existing = merged.get(record.serial);

    if (!existing) {
      merged.set(record.serial, {
        ...record,
        rawSerials: [record.rawSerial],
        owners: record.owner ? [record.owner] : [],
        licenses: [...record.licenses],
      });
      return;
    }

    if (!existing.rawSerials.includes(record.rawSerial)) {
      existing.rawSerials.push(record.rawSerial);
    }

    if (record.owner && !existing.owners.includes(record.owner)) {
      existing.owners.push(record.owner);
    }

    record.licenses.forEach((licenseName) => {
      if (!existing.licenses.includes(licenseName)) {
        existing.licenses.push(licenseName);
      }
    });
  });

  return [...merged.values()].map((record) => ({
    ...record,
    rawSerial: record.rawSerials[0],
    owner: record.owners[0] || record.owner,
  }));
}

function ownerState(owner) {
  const normalized = (owner || "").trim();
  return {
    label: normalized || "unknown",
    isNone: normalized.toLowerCase() === "none",
  };
}

function ownerLabels(record) {
  const owners = Array.isArray(record.owners) && record.owners.length ? record.owners : [record.owner];
  return owners.map((owner) => ownerState(owner).label);
}

function ownerGroupLabel(owner) {
  const label = ownerState(owner).label;
  return label.replace(/-\d+$/u, "");
}

function ownerGroupLabels(record) {
  const owners = Array.isArray(record.owners) && record.owners.length ? record.owners : [record.owner];
  return owners.map(ownerGroupLabel);
}

function hasOwnerState(record, state) {
  const states = ownerLabels(record).map((owner) => ownerState(owner));

  if (state === "none") {
    return states.some((owner) => owner.isNone);
  }

  if (state === "assigned") {
    return states.some((owner) => owner.label !== "unknown" && !owner.isNone);
  }

  return true;
}

function uniqueLicenses(records) {
  return [...new Set(records.flatMap((record) => record.licenses))];
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function unionLicenses(records) {
  return uniqueLicenses(records);
}

function getCompareTargets(records) {
  const targets = [];
  const ownerGroups = uniqueValues(records.flatMap(ownerGroupLabels));

  ownerGroups.forEach((ownerGroup) => {
    targets.push({
      value: `owner:${ownerGroup}`,
      label: `Owner ${ownerGroup}`,
      displayName: ownerGroup,
      records: records.filter((record) => ownerGroupLabels(record).includes(ownerGroup)),
    });
  });

  records.forEach((record) => {
    const owner = ownerState(record.owner).label;
    targets.push({
      value: `serial:${record.serial}`,
      label: `Serial ${record.serial} (${owner})`,
      displayName: `${owner} / ${record.serial}`,
      records: [record],
    });
  });

  return targets;
}

function findCompareTarget(value, records) {
  return getCompareTargets(records).find((target) => target.value === value) || null;
}

function getFilterValues() {
  return {
    searchTerms: searchInput.value
      .split(/[,;\n]+/)
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean),
    ownerStatus: ownerStatusFilter.value,
    owner: ownerFilter.value,
    serial: serialFilter.value,
    license: licenseFilter.value,
  };
}

function setSelectOptions(select, values, defaultLabel, currentValue) {
  select.innerHTML = `<option value="">${defaultLabel}</option>`;

  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });

  select.value = values.includes(currentValue) ? currentValue : "";
}

function renderFilters(records) {
  const currentFilters = getFilterValues();

  filterPanel.hidden = records.length === 0;
  setSelectOptions(ownerFilter, uniqueValues(records.flatMap(ownerGroupLabels)), "모든 Owner", currentFilters.owner);
  setSelectOptions(serialFilter, uniqueValues(records.map((record) => record.serial)), "모든 Serial", currentFilters.serial);
  setSelectOptions(licenseFilter, uniqueLicenses(records), "모든 License", currentFilters.license);
}

function setCompareSelectOptions(records) {
  const targets = getCompareTargets(records);
  const baselineValue = baselineSelect.value;
  const targetValue = targetSelect.value;

  baselineSelect.innerHTML = "";
  targetSelect.innerHTML = "";

  targets.forEach((target) => {
    const baselineOption = document.createElement("option");
    baselineOption.value = target.value;
    baselineOption.textContent = target.label;
    baselineSelect.appendChild(baselineOption);

    const targetOption = document.createElement("option");
    targetOption.value = target.value;
    targetOption.textContent = target.label;
    targetSelect.appendChild(targetOption);
  });

  if (targets.length > 0) {
    baselineSelect.value = targets.some((target) => target.value === baselineValue) ? baselineValue : targets[0].value;
    targetSelect.value = targets.some((target) => target.value === targetValue)
      ? targetValue
      : targets[Math.min(1, targets.length - 1)].value;
  }
}

function filterRecords(records) {
  const filters = getFilterValues();

  return records.filter((record) => {
    if (filters.ownerStatus && !hasOwnerState(record, filters.ownerStatus)) {
      return false;
    }

    if (filters.owner && !ownerGroupLabels(record).includes(filters.owner)) {
      return false;
    }

    if (filters.serial && record.serial !== filters.serial) {
      return false;
    }

    if (filters.license && !record.licenses.includes(filters.license)) {
      return false;
    }

    if (filters.searchTerms.length > 0) {
      const haystack = [
        record.serial,
        record.rawSerial,
        ...(record.rawSerials || []),
        ...ownerLabels(record),
        ...record.licenses,
      ]
        .join(" ")
        .toLowerCase();

      return filters.searchTerms.some((term) => haystack.includes(term));
    }

    return true;
  });
}

function resetFilters() {
  searchInput.value = "";
  ownerStatusFilter.value = "";
  ownerFilter.value = "";
  serialFilter.value = "";
  licenseFilter.value = "";
}

function getParsedRecords() {
  if (parserState.logText !== logInput.value) {
    parserState.logText = logInput.value;
    parserState.records = parseLicenseShow(logInput.value);
    renderFilters(parserState.records);
  }

  return parserState.records;
}

function renderCards(records) {
  serialCards.innerHTML = "";

  records.forEach((record) => {
    const card = document.createElement("article");
    card.className = "serial-card";

    const owner = ownerState(record.owner);
    const rawSerialNote =
      record.rawSerial === record.serial ? "" : `<span class="raw-serial">raw: ${escapeHtml(record.rawSerial)}</span>`;

    card.innerHTML = `
      <div class="serial-head">
        <div class="serial-main">
          <div class="serial-number">
            <strong>${escapeHtml(record.serial)}</strong>
            ${rawSerialNote}
          </div>
          <span class="owner-badge ${owner.isNone ? "none" : "assigned"}">
            ${owner.isNone ? "Owner none" : `Owner ${escapeHtml(owner.label)}`}
          </span>
        </div>
      </div>
      <ul class="license-list">
        ${
          record.licenses.length
            ? record.licenses.map((license) => `<li class="license-chip">${escapeHtml(license)}</li>`).join("")
            : '<li class="license-chip">No license rows</li>'
        }
      </ul>
    `;

    serialCards.appendChild(card);
  });
}

function renderMatrix(records, licenses) {
  const thead = matrixTable.querySelector("thead");
  const tbody = matrixTable.querySelector("tbody");

  thead.innerHTML = `
    <tr>
      <th>Serial Number</th>
      <th>Owner</th>
      ${licenses.map((license) => `<th>${escapeHtml(license)}</th>`).join("")}
    </tr>
  `;

  tbody.innerHTML = records
    .map((record) => {
      const owner = ownerState(record.owner);
      const cells = licenses
        .map((license) =>
          record.licenses.includes(license)
            ? '<td class="matrix-yes">YES</td>'
            : '<td class="matrix-no">-</td>',
        )
        .join("");

      return `
        <tr>
          <td>${escapeHtml(record.serial)}</td>
          <td>${owner.isNone ? "none" : escapeHtml(owner.label)}</td>
          ${cells}
        </tr>
      `;
    })
    .join("");
}

function renderComparison() {
  const records = parserState.visibleRecords;
  const baseline = findCompareTarget(baselineSelect.value, records);
  const target = findCompareTarget(targetSelect.value, records);

  if (!baseline || !target) {
    compareOutput.textContent = "<대상 장비>\n비교할 장비를 선택할 수 없습니다.";
    return;
  }

  const baselineLicenses = unionLicenses(baseline.records);
  const targetLicenses = unionLicenses(target.records);
  const additions = baselineLicenses.filter((license) => !targetLicenses.includes(license));
  const removals = targetLicenses.filter((license) => !baselineLicenses.includes(license));
  const lines = [`<${target.displayName}>`];

  if (additions.length === 0 && removals.length === 0) {
    lines.push("변경 없음");
  } else {
    additions.forEach((license) => lines.push(`+${license}`));
    removals.forEach((license) => lines.push(`-${license}`));
  }

  compareOutput.textContent = lines.join("\n");
}

function exportVisibleRecords() {
  const records = parserState.visibleRecords;
  const licenses = parserState.visibleLicenses;

  if (records.length === 0) {
    return;
  }

  const detailRows = records
    .map(
      (record) => `
        <tr>
          <td>${excelCell(record.serial)}</td>
          <td>${excelCell(record.rawSerial)}</td>
          <td>${excelCell(ownerState(record.owner).label)}</td>
          <td>${excelCell(ownerGroupLabels(record).join(", "))}</td>
          <td>${excelCell(record.licenses.join(", "))}</td>
        </tr>
      `,
    )
    .join("");

  const matrixHeaders = licenses.map((license) => `<th>${excelCell(license)}</th>`).join("");
  const matrixRows = records
    .map((record) => {
      const licenseCells = licenses
        .map((license) => `<td>${record.licenses.includes(license) ? "YES" : ""}</td>`)
        .join("");
      return `
        <tr>
          <td>${excelCell(record.serial)}</td>
          <td>${excelCell(ownerState(record.owner).label)}</td>
          <td>${excelCell(ownerGroupLabels(record).join(", "))}</td>
          ${licenseCells}
        </tr>
      `;
    })
    .join("");

  const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          table { border-collapse: collapse; }
          th, td { border: 1px solid #999; padding: 6px; mso-number-format:"\\@"; }
          th { background: #e9e5da; font-weight: bold; }
        </style>
      </head>
      <body>
        <h2>NetApp License Detail</h2>
        <table>
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Raw Serial</th>
              <th>Owner</th>
              <th>Owner Group</th>
              <th>Licenses</th>
            </tr>
          </thead>
          <tbody>${detailRows}</tbody>
        </table>
        <br />
        <h2>NetApp License Matrix</h2>
        <table>
          <thead>
            <tr>
              <th>Serial Number</th>
              <th>Owner</th>
              <th>Owner Group</th>
              ${matrixHeaders}
            </tr>
          </thead>
          <tbody>${matrixRows}</tbody>
        </table>
      </body>
    </html>
  `;

  downloadBlob(
    new Blob(["\ufeff", html], { type: "application/vnd.ms-excel;charset=utf-8" }),
    `netapp-license-${dateStamp()}.xls`,
  );
}

function excelCell(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

function dateStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function render() {
  const allRecords = getParsedRecords();
  const records = filterRecords(allRecords);
  const licenses = uniqueLicenses(records);
  const ownerNoneCount = records.filter((record) => hasOwnerState(record, "none")).length;
  const ownerAssignedCount = records.filter((record) => hasOwnerState(record, "assigned")).length;

  counters.serials.textContent = records.length;
  counters.ownerNone.textContent = ownerNoneCount;
  counters.ownerAssigned.textContent = ownerAssignedCount;
  counters.licenses.textContent = licenses.length;
  parserState.visibleRecords = records;
  parserState.visibleLicenses = licenses;

  const hasParsedRecords = allRecords.length > 0;
  const hasVisibleRecords = records.length > 0;
  emptyState.hidden = hasVisibleRecords;
  serialCards.hidden = !hasVisibleRecords;
  compareSection.hidden = !hasVisibleRecords;
  matrixSection.hidden = !hasVisibleRecords;
  exportExcelButton.disabled = !hasVisibleRecords;

  if (!hasParsedRecords) {
    parseStatus.textContent = logInput.value.trim()
      ? "(system license show) 출력 구간을 찾지 못했습니다."
      : "로그를 붙여넣으면 자동으로 분석됩니다.";
    emptyState.innerHTML =
      "<strong>아직 분석된 license show 출력이 없습니다.</strong><span>잘못 입력한 명령어가 있어도 바로 아래의 <code>(system license show)</code> 줄을 기준으로 파싱합니다.</span>";
    serialCards.innerHTML = "";
    compareOutput.textContent = "<대상 장비>\n기준 장비와 대상 장비를 선택하고 비교하기를 누르세요.";
    matrixTable.querySelector("thead").innerHTML = "";
    matrixTable.querySelector("tbody").innerHTML = "";
    return;
  }

  if (!hasVisibleRecords) {
    parseStatus.textContent = `전체 ${allRecords.length}개 시리얼 중 필터 조건에 맞는 결과가 없습니다.`;
    emptyState.innerHTML =
      "<strong>필터 조건에 맞는 결과가 없습니다.</strong><span>검색어 또는 Owner, Serial, License 필터를 조정해보세요.</span>";
    serialCards.innerHTML = "";
    compareOutput.textContent = "<대상 장비>\n필터 조건에 맞는 비교 대상이 없습니다.";
    matrixTable.querySelector("thead").innerHTML = "";
    matrixTable.querySelector("tbody").innerHTML = "";
    return;
  }

  parseStatus.textContent =
    records.length === allRecords.length
      ? `${records.length}개 시리얼과 ${licenses.length}개 license를 찾았습니다.`
      : `전체 ${allRecords.length}개 중 ${records.length}개 시리얼을 표시합니다.`;
  renderCards(records);
  setCompareSelectOptions(records);
  renderMatrix(records, licenses);
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

logInput.addEventListener("input", scheduleRender);
searchInput.addEventListener("input", scheduleRender);
ownerStatusFilter.addEventListener("change", render);
ownerFilter.addEventListener("change", render);
serialFilter.addEventListener("change", render);
licenseFilter.addEventListener("change", render);
logFileInput.addEventListener("change", async () => {
  const file = logFileInput.files?.[0];

  if (!file) {
    return;
  }

  logInput.value = await file.text();
  resetFilters();
  render();
  logFileInput.value = "";
});
sampleButton.addEventListener("click", () => {
  logInput.value = sampleLog;
  resetFilters();
  render();
});
clearButton.addEventListener("click", () => {
  logInput.value = "";
  resetFilters();
  render();
  logInput.focus();
});
resetFiltersButton.addEventListener("click", () => {
  resetFilters();
  render();
  searchInput.focus();
});
exportExcelButton.addEventListener("click", exportVisibleRecords);
compareButton.addEventListener("click", renderComparison);

render();
