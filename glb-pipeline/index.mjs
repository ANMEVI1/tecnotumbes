/**
 * Punto de entrada programático oficial del módulo GLB de TECNO · TUMBES.
 * Permite a scripts, pipelines CI y Skills de agentes IA operar directamente
 * sobre el análisis, diff, orquestación y verificación sin acoplarse al CLI.
 */

export { analyzeGlbFile, GlbValidationError } from './lib/glb-parser.mjs';
export {
  PATHS,
  PipelineError,
  loadMappingConfig,
  loadManifest,
  resolvePhpBin,
  analyzeModel,
  diffModels,
  applyModel,
  listModels,
  activateModel,
  verifyActiveModel,
} from './lib/orchestrator.mjs';
