/**
 * Variables the agent host must not inherit: proxy settings, which could send its loopback
 * traffic through another machine; anything that looks like a credential, since a graduate runs
 * offline and needs none; and NODE_OPTIONS, which could load code before its network guard.
 */
const WITHHELD = /proxy|key|token|secret|passw|credential|auth|^node_options$/i;

/** The app's environment, minus what the agent host must not see. */
export function agentHostEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !WITHHELD.test(name)));
}
