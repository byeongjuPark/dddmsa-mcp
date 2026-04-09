import { describe, it, expect } from 'vitest';
import { resolveSafePath } from '../src/utils/pathUtils.js';
import path from 'path';

describe('resolveSafePath', () => {
    it('should resolve a valid inner path successfully', () => {
        const base = path.join(__dirname, 'mockBase');
        const userPath = 'src/app.ts';
        const result = resolveSafePath(base, userPath);
        expect(result).toBe(path.join(base, userPath));
    });

    it('should throw error when navigating outside using ../', () => {
        const base = path.join(__dirname, 'mockBase');
        const userPath = '../outside.ts';
        expect(() => resolveSafePath(base, userPath)).toThrow(/Security Violation/);
    });

    it('should throw an error for absolute paths outside the base', () => {
        const base = path.join(__dirname, 'mockBase');
        const userPath = path.resolve('/', 'etc', 'passwd'); // C:\etc\passwd on windows
        expect(() => resolveSafePath(base, userPath)).toThrow(/Security Violation/);
    });

    it('should allow a path that uses ../ but stays inside', () => {
        const base = path.join(__dirname, 'mockBase');
        const userPath = 'src/../src/app.ts';
        const result = resolveSafePath(base, userPath);
        expect(result).toBe(path.join(base, 'src/app.ts'));
    });
});
