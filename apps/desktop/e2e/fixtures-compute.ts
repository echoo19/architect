/**
 * A stand-in for Glimmer's config.json, shaped like a 30B mixture of experts, that a fake Hub
 * serves so Compute can plan for it. Not Glimmer's real config.json, which no test reads.
 */
export const GLIMMER_STAND_IN_CONFIG = {
  model_type: 'muse_glimmer',
  hidden_size: 2048,
  intermediate_size: 6144,
  moe_intermediate_size: 768,
  num_hidden_layers: 48,
  num_attention_heads: 32,
  num_key_value_heads: 4,
  head_dim: 128,
  num_experts: 128,
  num_experts_per_tok: 8,
  vocab_size: 151936,
  tie_word_embeddings: false,
  torch_dtype: 'bfloat16',
};
