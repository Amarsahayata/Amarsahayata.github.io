import "dotenv/config";
import fs from "node:fs/promises";
import * as cheerio from "cheerio";

const SOURCES = [
  {name:"Government of West Bengal — Official Portal", url:"https://wb.gov.in/"},
  {name:"Government of West Bengal — Schemes", url:"https://wb.gov.in/government-schemes.aspx"},
  {name:"Government of West Bengal — E-Services", url:"https://wb.gov.in/e-services.aspx"},
  {name:"Annapurna Yojana", url:"https://wb.gov.in/government-schemes-details-annaapurna-yojana.aspx"},
  {name:"Banglar Yuba Shakti", url:"https://yubasathi.wb.gov.in"},
  {name:"PM-JAY Beneficiary Portal", url:"https://beneficiary.nha.gov.in/"},
  {name:"PIB — West Bengal PM-JAY implementation", url:"https://www.pib.gov.in/PressReleasePage.aspx?PRID=2270375&lang=1&reg=48"},
  {name:"West Bengal Agriculture — Krishak Bandhu (Natun)", url:"https://agriculture.wb.gov.in/krishak-bandhu-natun-"},
  {name:"Taposili Bandhu", url:"https://wb.gov.in/government-schemes-details-taposili-bandhu-scheme.aspx"},
  {name:"OASIS Scholarship", url:"https://oasis.wb.gov.in/"}
];

function cleanText(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, 30000);
}

async function fetchSource(source) {
  const r = await fetch(source.url, {headers: {"User-Agent":"Amar-Sahayata-Official-Source-Monitor/3.0"}});
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return {...source, text: cleanText(await r.text()), checkedAt: new Date().toISOString()};
}

async function main() {
  const results = [];
  for (const source of SOURCES) {
    try { results.push(await fetchSource(source)); }
    catch (e) { results.push({...source, error:e.message, checkedAt:new Date().toISOString()}); }
  }
  await fs.mkdir("./data", {recursive:true});
  await fs.writeFile("./data/official-sources.json", JSON.stringify({
    generatedAt:new Date().toISOString(),
    policy:"Official-source monitoring only; failed sources are not published as verified links.",
    sources:results
  }, null, 2));
  console.log("Official source scan completed.");
}
main().catch(err => {console.error(err); process.exit(1)});
