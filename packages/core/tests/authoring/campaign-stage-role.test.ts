import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  AuthoringError, CAMPAIGN_STAGE_KINDS, ROLES, refuseCampaignStageRole, validateGraph,
} from '../../src/authoring';
import { graph } from './fixtures';

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AuthoringError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('campaign stage role refusal', () => {
  test('refuses the two campaign stage kinds and never returns a role', () => {
    expect([...CAMPAIGN_STAGE_KINDS]).toEqual(['range', 'synthesis']);
    for (const kind of CAMPAIGN_STAGE_KINDS) {
      expect(refusal(() => refuseCampaignStageRole(kind))).toBe('campaign-stage-not-a-role');
      expect(ROLES).not.toContain(kind);
    }
    expect(ROLES).toEqual([
      'architect', 'character-planner', 'drafter', 'developmental-reviewer',
      'line-reviewer', 'revision-writer', 'canon-summarizer',
    ]);
  });

  test('refuses every other value, including a role name, before the mapping refusal', () => {
    for (const role of ROLES) {
      expect(refusal(() => refuseCampaignStageRole(role))).toBe('unknown-stage-kind');
    }
    for (const kind of ['Range', 'SYNTHESIS', ' range', 'range ', '', 'summary', 'task']) {
      expect(refusal(() => refuseCampaignStageRole(kind))).toBe('unknown-stage-kind');
    }
    for (const kind of [null, undefined, 1, true, ['range'], { kind: 'range' }]) {
      expect(refusal(() => refuseCampaignStageRole(kind))).toBe('unknown-stage-kind');
    }
  });

  test('does not read a stage object', () => {
    let called = 0;
    const stage = {};
    Object.defineProperty(stage, 'kind', {
      enumerable: true,
      get() { called += 1; return 'range'; },
    });
    expect(refusal(() => refuseCampaignStageRole(stage))).toBe('unknown-stage-kind');
    expect(called).toBe(0);
  });

  test('leaves graph validation refusing a stage kind as an unknown role', () => {
    for (const kind of CAMPAIGN_STAGE_KINDS) {
      const input = graph();
      const task = input.tasks[0];
      if (!task) throw new Error('fixture');
      task.role = kind as typeof task.role;
      expect(refusal(() => validateGraph(input))).toBe('unknown-role');
    }
  });

  test('is not called by the continuation leaf and does not build a task', () => {
    const contracts = readFileSync(new URL('../../src/authoring/contracts.ts', import.meta.url), 'utf8');
    const start = contracts.indexOf('export function refuseCampaignStageRole');
    const end = contracts.indexOf('export const DEFAULT_LIMITS');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = contracts.slice(start, end);
    expect(body).toContain("throw new AuthoringError('campaign-stage-not-a-role')");
    expect(body).not.toContain('return ');
    expect(body).not.toContain('TaskDefinition');
    const leaf = readFileSync(
      new URL('../../src/review/campaign-continuation-checkin.ts', import.meta.url), 'utf8',
    );
    expect(leaf.includes('refuseCampaignStageRole')).toBe(true);
    expect(leaf.includes('refuseCampaignStageRole(')).toBe(false);
  });
});
