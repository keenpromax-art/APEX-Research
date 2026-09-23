/**
 * Unified transport for orchestration — adapters over the four existing
 * shapes so provider failover / interchangeability stays where it lives
 * (ai-providers.ts + openrouter failover / makeProviderTransport).
 *
 * This module never fetches, never lists models, and never branches on
 * provider id. Tests inject mock transports of any shape and prove the
 * same orchestration runs.
 */
import type { TeamTransport, ModelTier } from "@/lib/agent-team";
import type { AiFirstTransport } from "@/lib/ai-first/llm";
import type { PlannerTransport } from "@/lib/ai-first/research-planner";
import type { PipelineTransport } from "@/lib/ai-first/pipeline";

export interface OrchestrationCall {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Author/checker routing hints (TeamTransport opts). */
  tier?: ModelTier;
  roleId?: string;
}

export interface OrchestrationTransport {
  complete(call: OrchestrationCall): Promise<string>;
}

/** Agent-team object-arg shape → orchestration. */
export function fromTeamTransport(team: TeamTransport): OrchestrationTransport {
  return {
    complete(call) {
      return team.complete(
        { system: call.system, user: call.user },
        { tier: call.tier ?? "standard", roleId: call.roleId ?? "unknown" }
      );
    },
  };
}

/** Orchestration → agent-team object-arg shape. */
export function toTeamTransport(t: OrchestrationTransport): TeamTransport {
  return {
    complete(prompt, opts) {
      return t.complete({
        system: prompt.system,
        user: prompt.user,
        tier: opts?.tier,
        roleId: opts?.roleId,
      });
    },
  };
}

/** Function-style PlannerTransport / PipelineTransport (identical shape) → orchestration. */
export function fromFunctionTransport(
  fn: PlannerTransport | PipelineTransport
): OrchestrationTransport {
  return {
    complete(call) {
      return fn({
        system: call.system,
        user: call.user,
        temperature: call.temperature,
        maxTokens: call.maxTokens,
        jsonMode: call.jsonMode,
      });
    },
  };
}

/** Orchestration → function-style PlannerTransport / PipelineTransport. */
export function toFunctionTransport(
  t: OrchestrationTransport
): PlannerTransport {
  return (opts) =>
    t.complete({
      system: opts.system,
      user: opts.user,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
    });
}

/** AiFirstTransport two-string method shape → orchestration. */
export function fromAiFirstTransport(transport: AiFirstTransport): OrchestrationTransport {
  return {
    complete(call) {
      return transport.complete(call.system, call.user, {
        temperature: call.temperature,
        maxTokens: call.maxTokens,
        jsonMode: call.jsonMode,
      });
    },
  };
}

/** Orchestration → AiFirstTransport. */
export function toAiFirstTransport(t: OrchestrationTransport): AiFirstTransport {
  return {
    complete(system, user, opts) {
      return t.complete({
        system,
        user,
        temperature: opts?.temperature,
        maxTokens: opts?.maxTokens,
        jsonMode: opts?.jsonMode,
      });
    },
  };
}
