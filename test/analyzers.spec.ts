import { describe, it, expect } from 'vitest';
import { analyzeServiceDependencies } from '../src/tools/analyzeServiceDependencies.js';
import path from 'path';

describe('Extractors Golden Fixture tests', () => {
    it('should correctly capture dependencies in typescript mock via AST', async () => {
        const fixturePath = path.join('test', 'fixtures', 'typescript-mock');
        const res = await analyzeServiceDependencies({ targetPath: fixturePath });
        
        expect(res.isError).toBeFalsy();
        const content = res.content[0].text;
        
        // Assert JSON standard returned
        const jsonRes = JSON.parse(content);
        expect(Array.isArray(jsonRes)).toBe(true);
        expect(content).toContain('DEP-ANALYSIS-002');
        
        // Assert that the TS AST properly captured all elements
        expect(content).toContain('http://api.service.com/v1/user');
        expect(content).toContain('GetUserInfo');
        expect(content).toContain('USER_CREATED');
        expect(content).toContain('pg');
    });

    it('should correctly capture dependencies in java mock via AST', async () => {
        const fixturePath = path.join('test', 'fixtures', 'java-mock');
        const res = await analyzeServiceDependencies({ targetPath: fixturePath });
        
        expect(res.isError).toBeFalsy();
        const content = res.content[0].text;
        
        const jsonRes = JSON.parse(content);
        expect(Array.isArray(jsonRes)).toBe(true);
        expect(content).toContain('DEP-ANALYSIS-002');
        
        // Assert that the Java AST properly captured elements
        expect(content).toContain('http://api.external.com/users');
        expect(content).toContain('HTTP API');
    });

    it('should detect shared database resources across service directories', async () => {
        const fixturePath = path.join('test', 'fixtures', 'shared-db');
        const res = await analyzeServiceDependencies({ targetPath: fixturePath });

        expect(res.isError).toBeFalsy();
        const findings = JSON.parse(res.content[0].text);
        const sharedDbFinding = findings.find((finding: any) => finding.ruleId === 'MSA-DB-SHARED');

        expect(sharedDbFinding).toBeTruthy();
        expect(sharedDbFinding.evidence).toHaveLength(2);
        expect(JSON.stringify(sharedDbFinding)).toContain('order-service');
        expect(JSON.stringify(sharedDbFinding)).toContain('billing-service');
    });

    it('should build a service graph and detect cycles and hotspots', async () => {
        const fixturePath = path.join('test', 'fixtures', 'service-graph');
        const res = await analyzeServiceDependencies({ targetPath: fixturePath });

        expect(res.isError).toBeFalsy();
        const findings = JSON.parse(res.content[0].text);
        const graph = findings.find((finding: any) => finding.ruleId === 'DEP-GRAPH');
        const cycle = findings.find((finding: any) => finding.ruleId === 'DEP-GRAPH-CYCLE');
        const hotspot = findings.find((finding: any) => finding.ruleId === 'DEP-GRAPH-HOTSPOT');

        expect(graph).toBeTruthy();
        expect(JSON.stringify(graph)).toContain('order-service -> billing-service [sync-http]');
        expect(JSON.stringify(graph)).toContain('order-service -> order.created [async-message]');
        expect(JSON.stringify(cycle)).toContain('billing-service');
        expect(JSON.stringify(cycle)).toContain('order-service');
        expect(JSON.stringify(hotspot)).toContain('reporting-service has 4 outgoing');
    });
});
