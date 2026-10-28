import type { GpuLease, GpuPurpose } from '../local-runtime';
import type { AdapterDeps, EngineHostDeps } from '../loop/deps';

/**
 * The engine's dependencies with every student on Ollama on this computer holding the GPU lease
 * for each request, for `purpose` (decision 046). Without a lease they are the same dependencies.
 */
export function studentsHolding(
  deps: EngineHostDeps,
  gpu: GpuLease | undefined,
  purpose: GpuPurpose,
): EngineHostDeps {
  if (gpu === undefined) return deps;
  const createStudent: AdapterDeps['createStudent'] = (endpoint, studentOptions) =>
    gpu.ollama.student(endpoint, deps.adapters.createStudent(endpoint, studentOptions), purpose);
  return { ...deps, adapters: { ...deps.adapters, createStudent } };
}
