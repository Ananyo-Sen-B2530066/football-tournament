// ============================================================
// TechFest 2027 — Google Apps Script for UI → Sheet write-back
// Setup (one time, ~5 min, needs internet):
//  1. Open your Google Sheet → Extensions → Apps Script.
//  2. Paste this whole file, set SHEET_SECRET below (any random string).
//  3. Deploy → New deployment → type Web app → Execute as Me,
//     Who has access: Anyone (or Anyone with link) → Deploy.
//  4. Copy the Web App URL into config/tournament.config.ts → SHEET_WEBAPP_URL
//     and the same secret into SHEET_SECRET.
// Sheet layout: Results tab headers must include:
//  match_id | stage | round | player_a | player_b | score_a | score_b | played | winner | updated_at
// ============================================================
var SHEET_SECRET = ""; // e.g. "techfest-42x-secret" — must match SHEET_SECRET in app config (leave "" to disable check)
var RESULTS_TAB = "Results";

function findCol_(headers, name) {
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === name) return i + 1; // 1-based
  }
  return -1;
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, tab: RESULTS_TAB }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    if (SHEET_SECRET && body.secret !== SHEET_SECRET) {
      return json_({ ok: false, error: "bad secret" });
    }
    if (!body.match_id) return json_({ ok: false, error: "missing match_id" });

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RESULTS_TAB);
    if (!sh) return json_({ ok: false, error: "no Results tab" });
    var values = sh.getDataRange().getValues();
    var headers = values[0];
    var cId = findCol_(headers, "match_id");
    var cSa = findCol_(headers, "score_a");
    var cSb = findCol_(headers, "score_b");
    var cPlayed = findCol_(headers, "played");
    var cWinner = findCol_(headers, "winner");
    var cTime = findCol_(headers, "updated_at");
    if (cId < 0 || cSa < 0) return json_({ ok: false, error: "missing columns" });

    var row = -1;
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][cId - 1]).trim() === String(body.match_id).trim()) { row = r + 1; break; }
    }
    if (row < 0) return json_({ ok: false, error: "unknown match_id: " + body.match_id });

    // LAST-WRITE-WINS: skip if sheet already has a newer timestamp
    if (cTime > 0 && body.updated_at) {
      var cur = values[row - 1][cTime - 1];
      var curT = cur ? Date.parse(cur) : NaN;
      var newT = Date.parse(body.updated_at);
      if (!isNaN(curT) && !isNaN(newT) && curT > newT) {
        return json_({ ok: true, skipped: true, reason: "sheet newer" });
      }
    }
    sh.getRange(row, cSa).setValue(body.score_a === null || body.score_a === undefined ? "" : body.score_a);
    sh.getRange(row, cSb).setValue(body.score_b === null || body.score_b === undefined ? "" : body.score_b);
    if (cPlayed > 0) sh.getRange(row, cPlayed).setValue(body.played ? "TRUE" : "FALSE");
    if (cWinner > 0) sh.getRange(row, cWinner).setValue(body.winner || "");
    if (cTime > 0) sh.getRange(row, cTime).setValue(body.updated_at || new Date().toISOString());
    return json_({ ok: true, row: row });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
