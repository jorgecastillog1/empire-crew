// ============================================================
// GROQ MODELS: Selección inteligente por tarea
// ============================================================

export const GROQ_MODELS = {
  // Tareas complejas: análisis, diseño de agentes, consenso
  powerful: 'openai/gpt-oss-120b',
  // Tareas intermedias: orquestación, evaluación, planning
  balanced: 'llama-3.3-70b-versatile',
  // Tareas rápidas: routing, clasificación, vetos
  fast: 'openai/gpt-oss-20b',
  // Tareas simples: compresión, extracción, cache
  instant: 'llama-3.1-8b-instant',
  // Preview: multimodal (con precaución)
  scout: 'meta-llama/llama-4-scout-17b-16e-instruct',
};

export type TaskType =
  | 'agent_design'      // Diseñar super agentes (800+ palabras)
  | 'consensus'         // Consenso entre agentes
  | 'analysis'          // Análisis de mercado, evaluación
  | 'routing'           // Enrutamiento semántico
  | 'compression'       // Comprimir tasks, extraer puntos clave
  | 'veto'              // Evaluar vetos
  | 'planning'          // HTN planning
  | 'judge'             // Juzgar agentes
  | 'video_analysis'    // Analizar productos para video
  | 'general';          // General

export function selectModel(task: TaskType): string {
  switch (task) {
    case 'agent_design':
    case 'consensus':
    case 'video_analysis':
      return GROQ_MODELS.powerful;

    case 'analysis':
    case 'planning':
    case 'judge':
      return GROQ_MODELS.balanced;

    case 'routing':
    case 'veto':
      return GROQ_MODELS.fast;

    case 'compression':
      return GROQ_MODELS.instant;

    default:
      return GROQ_MODELS.balanced;
  }
}

// Fallback chain si un modelo falla
export const MODEL_FALLBACK: Record<string, string> = {
  [GROQ_MODELS.powerful]: GROQ_MODELS.balanced,
  [GROQ_MODELS.balanced]: GROQ_MODELS.fast,
  [GROQ_MODELS.fast]: GROQ_MODELS.instant,
  [GROQ_MODELS.instant]: GROQ_MODELS.instant,
};