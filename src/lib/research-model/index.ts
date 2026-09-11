/**
 * APEX RESEARCH — research-model barrel.
 * The operating model is built once per report and shared by every section.
 */
export {
  buildResearchOperatingModel,
  getOperatingModelDigest,
  RESEARCH_MODEL_VERSION,
  type ResearchOperatingModel,
  type BuildModelInput,
} from "./operating-model";
export {
  SECTOR_DRIVER_PACKS,
  getSectorDriverPack,
  isKnownSectorPack,
  type SectorDriverPack,
} from "./sector-drivers";
export {
  NARRATIVE_SECTIONS,
  boundaryHit,
  scanTextForModel,
  validateSection,
  validateReport as validateReportAgainstModel,
  type NarrativeSectionName,
  type SectionScan,
  type ReportModelValidation,
} from "./model-validator";
