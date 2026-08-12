import type { MeguminProfile } from "./types";

export function patchComfyWorkflow(connection: any, profile: MeguminProfile, prompt: string): Record<string, unknown> | undefined {
  const config = connection?.metadata?.comfyui;
  if (!config?.workflow_api_json || !Array.isArray(config.field_mappings)) return undefined;
  const workflow = JSON.parse(JSON.stringify(config.workflow_api_json));
  const values: Record<string, unknown> = {
    positive_prompt: prompt,
    negative_prompt: profile.imageGen.customNegative,
    seed: profile.imageGen.customSeed >= 0 ? profile.imageGen.customSeed : Math.floor(Math.random() * 1_000_000_000),
    steps: profile.imageGen.steps,
    cfg: profile.imageGen.cfg,
    sampler_name: profile.imageGen.selectedSampler,
    scheduler: profile.imageGen.scheduler,
    width: profile.imageGen.imgWidth,
    height: profile.imageGen.imgHeight,
    checkpoint: profile.imageGen.selectedModel,
    lora_name: profile.imageGen.selectedLora,
    lora_strength_model: profile.imageGen.selectedLoraWt,
    lora_strength_clip: profile.imageGen.selectedLoraWt
  };
  for (const mapping of config.field_mappings) {
    const node = workflow[mapping.nodeId];
    if (!node?.inputs) continue;
    const value = values[mapping.mappedAs];
    if (value !== undefined && value !== "") node.inputs[mapping.fieldName] = value;
  }
  return workflow;
}
