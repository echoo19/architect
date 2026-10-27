# Gotchas

Things that bit us, and how to avoid them. Newest first.

## Muse Glimmer is a dense 30B model

The Ollama tag `muse-glimmer:30b` is 18 GB at 4-bit. On a 12 GB GPU it spills about 7 GB into system memory, so generation speed depends on free RAM and memory bandwidth. Check available memory before a long local run; other programs holding RAM will push the model into paging.

## typescript-eslint caps the TypeScript version

typescript-eslint 8 supports TypeScript below 6.1. Keep the workspace on TypeScript 6.0.x until that changes.

## The Meta Model API key name

The Meta docs call the key `MODEL_API_KEY`, and the OpenAI SDK does not read it automatically: pass `apiKey` explicitly. In the app the key comes from Settings, never from the environment.
