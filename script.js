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

  const detailRows = [
    ["Serial Number", "Raw Serial", "Owner", "Owner Group", "Licenses"].map((value) => ({ value, style: 1 })),
    ...records.map((record) => [
      record.serial,
      record.rawSerial,
      ownerState(record.owner).label,
      ownerGroupLabels(record).join(", "),
      record.licenses.join(", "),
    ]),
  ];

  const diffLicenses = new Set(
    licenses.filter((license) => {
      const states = records.map((record) => record.licenses.includes(license));
      return new Set(states).size > 1;
    }),
  );

  const matrixRows = [
    ["Serial Number", "Owner", "Owner Group", ...licenses].map((value) => ({ value, style: 1 })),
    ...records.map((record) => [
      record.serial,
      ownerState(record.owner).label,
      ownerGroupLabels(record).join(", "),
      ...licenses.map((license) => ({
        value: record.licenses.includes(license) ? "YES" : "",
        style: diffLicenses.has(license) ? 2 : 0,
      })),
    ]),
  ];

  const workbook = createXlsxWorkbook([
    { name: "Detail", rows: detailRows },
    { name: "NetApp License Matrix", rows: matrixRows },
  ]);

  downloadBlob(workbook, `netapp-license-${dateStamp()}.xlsx`);
}

function createXlsxWorkbook(sheets) {
  const files = [
    { name: "[Content_Types].xml", data: textBytes(contentTypesXml(sheets.length)) },
    { name: "_rels/.rels", data: textBytes(rootRelsXml()) },
    { name: "xl/workbook.xml", data: textBytes(workbookXml(sheets)) },
    { name: "xl/_rels/workbook.xml.rels", data: textBytes(workbookRelsXml(sheets.length)) },
    { name: "xl/styles.xml", data: textBytes(stylesXml()) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: textBytes(worksheetXml(sheet.rows)),
    })),
  ];

  return new Blob([zipFiles(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function contentTypesXml(sheetCount) {
  const sheetTypes = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetTypes}
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbookXml(sheets) {
  const sheetNodes = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetNodes}</sheets>
</workbook>`;
}

function workbookRelsXml(sheetCount) {
  const sheetRels = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Malgun Gothic"/></font>
    <font><b/><sz val="11"/><name val="Malgun Gothic"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="49" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
    <xf numFmtId="49" fontId="0" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function worksheetXml(rows) {
  const rowNodes = rows
    .map((row, rowIndex) => {
      const cellNodes = row
        .map((cell, columnIndex) => cellXml(cell, columnName(columnIndex) + (rowIndex + 1)))
        .join("");
      return `<row r="${rowIndex + 1}">${cellNodes}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowNodes}</sheetData>
</worksheet>`;
}

function cellXml(cell, ref) {
  const normalized = typeof cell === "object" && cell !== null ? cell : { value: cell, style: 0 };
  const value = normalized.value ?? "";
  const style = normalized.style ? ` s="${normalized.style}"` : "";

  if (value === "") {
    return `<c r="${ref}"${style}/>`;
  }

  return `<c r="${ref}" t="inlineStr"${style}><is><t>${xmlEscape(value)}</t></is></c>`;
}

function columnName(index) {
  let dividend = index + 1;
  let name = "";

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return name;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textBytes(text) {
  return new TextEncoder().encode(text);
}

function zipFiles(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = textBytes(file.name);
    const data = file.data;
    const crc = crc32(data);
    const { time, date } = dosDateTime(new Date());
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  return concatBytes([...localParts, ...centralParts, end]);
}

function concatBytes(parts) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });

  return output;
}

function dosDateTime(dateObject) {
  const year = Math.max(dateObject.getFullYear(), 1980);
  return {
    time: (dateObject.getHours() << 11) | (dateObject.getMinutes() << 5) | Math.floor(dateObject.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((dateObject.getMonth() + 1) << 5) | dateObject.getDate(),
  };
}

const crcTable = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;

  bytes.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });

  return (crc ^ 0xffffffff) >>> 0;
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
