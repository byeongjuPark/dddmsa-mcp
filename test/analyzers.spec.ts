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
});
