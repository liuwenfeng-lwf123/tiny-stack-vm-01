// Tiny stack VM for make.fun's tiny stack ISA v1.
// Plain JavaScript syntax in a .ts file; Node strips types natively.
const fs = require('node:fs');
const path = require('node:path');

function run(p, inp) {
  const s = [], c = [], m = new Int32Array(256), o = [];
  let pc = 0, ip = 0, t = 0;
  const n = p.length;
  // Signed 16-bit little-endian immediate at pc+1.
  const i16 = () => { const v = p[pc + 1] | (p[pc + 2] << 8); return v > 32767 ? v - 65536 : v; };
  for (;;) {
    if (t >= 1000000) return [o, 10];          // step limit
    if (pc < 0 || pc >= n) return [o, 9];      // pc outside program
    const op = p[pc];
    const L = op === 1 ? 1 : op === 2 ? 4 : op >= 48 && op <= 51 ? 2 : 0;
    if (pc + 1 + L > n) return [o, 9];         // immediate cut off
    t++;
    switch (op) {
      case 0: return [o, 0];                   // HALT
      case 1:                                  // PUSH8, sign-extended
        if (s.length > 255) return [o, 3];
        s.push(p[pc + 1] > 127 ? p[pc + 1] - 256 : p[pc + 1]);
        pc += 2; break;
      case 2:                                  // PUSH32
        if (s.length > 255) return [o, 3];
        s.push(p[pc + 1] | (p[pc + 2] << 8) | (p[pc + 3] << 16) | (p[pc + 4] << 24));
        pc += 5; break;
      case 3:                                  // POP
        if (!s.length) return [o, 2];
        s.pop(); pc++; break;
      case 4:                                  // DUP
        if (!s.length) return [o, 2];
        if (s.length > 255) return [o, 3];
        s.push(s[s.length - 1]); pc++; break;
      case 5:                                  // SWAP
        if (s.length < 2) return [o, 2];
        { const l = s.length, x = s[l - 1]; s[l - 1] = s[l - 2]; s[l - 2] = x; }
        pc++; break;
      case 6:                                  // OVER
        if (s.length < 2) return [o, 2];
        if (s.length > 255) return [o, 3];
        s.push(s[s.length - 2]); pc++; break;
      case 7:                                  // ROT (a b c -- b c a)
        if (s.length < 3) return [o, 2];
        { const l = s.length, a = s[l - 3]; s[l - 3] = s[l - 2]; s[l - 2] = s[l - 1]; s[l - 1] = a; }
        pc++; break;
      case 16: case 17: case 18: case 19: case 20: case 21: case 22:
      case 24: case 25: case 26: case 28: case 29: case 30: case 32: case 33: case 34: {
        if (s.length < 2) return [o, 2];
        const b = s.pop(), a = s.pop();
        let r;
        if (op === 16) r = (a + b) | 0;                    // ADD wraps
        else if (op === 17) r = (a - b) | 0;               // SUB wraps
        else if (op === 18) r = Math.imul(a, b);           // MUL low 32 bits
        else if (op === 19) { if (!b) return [o, 4]; r = (a / b) | 0; } // DIV truncates toward zero; -2^31/-1 wraps to -2^31
        else if (op === 20) { if (!b) return [o, 4]; r = a % b; }       // MOD, sign of a; x%-1 is 0
        else if (op === 21) { if (!b) return [o, 4]; r = ((a >>> 0) / (b >>> 0)) | 0; } // DIVU
        else if (op === 22) { if (!b) return [o, 4]; r = ((a >>> 0) % (b >>> 0)) | 0; } // MODU
        else if (op === 24) r = a & b;
        else if (op === 25) r = a | b;
        else if (op === 26) r = a ^ b;
        else if (op === 28) r = a << (b & 31);             // SHL, low 5 bits only
        else if (op === 29) r = a >> (b & 31);             // SHR arithmetic
        else if (op === 30) r = (a >>> (b & 31)) | 0;      // SHRU logical
        else if (op === 32) r = a === b ? 1 : 0;           // EQ
        else if (op === 33) r = a < b ? 1 : 0;             // LT signed
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;            // LTU unsigned
        s.push(r); pc++; break;
      }
      case 23:                                 // NEG wraps
        if (!s.length) return [o, 2];
        s[s.length - 1] = (-s[s.length - 1]) | 0; pc++; break;
      case 27:                                 // NOT
        if (!s.length) return [o, 2];
        s[s.length - 1] = ~s[s.length - 1]; pc++; break;
      case 48: pc = pc + 3 + i16(); break;     // JMP
      case 49: case 50: {                      // JZ / JNZ
        if (!s.length) return [o, 2];
        const v = s.pop();
        pc = (op === 49 ? v === 0 : v !== 0) ? pc + 3 + i16() : pc + 3;
        break;
      }
      case 51:                                 // CALL, unsigned target
        if (c.length > 63) return [o, 7];
        c.push(pc + 3); pc = p[pc + 1] | (p[pc + 2] << 8); break;
      case 52:                                 // RET
        if (!c.length) return [o, 8];
        pc = c.pop(); break;
      case 64: {                               // LOAD
        if (!s.length) return [o, 2];
        const a = s.pop();
        if (a < 0 || a > 255) return [o, 6];
        s.push(m[a]); pc++; break;
      }
      case 65: {                               // STORE (v addr --)
        if (s.length < 2) return [o, 2];
        const a = s.pop(), v = s.pop();
        if (a < 0 || a > 255) return [o, 6];
        m[a] = v; pc++; break;
      }
      case 80: {                               // PRINT decimal ASCII, no newline
        if (!s.length) return [o, 2];
        const d = String(s.pop());
        if (o.length + d.length > 65536) return [o, 11];
        for (let i = 0; i < d.length; i++) o.push(d.charCodeAt(i));
        pc++; break;
      }
      case 81:                                 // PUTC one byte
        if (!s.length) return [o, 2];
        if (o.length > 65535) return [o, 11];
        o.push(s.pop() & 255); pc++; break;
      case 82:                                 // IN, -1 past end of input
        if (s.length > 255) return [o, 3];
        s.push(ip < inp.length ? inp[ip++] : -1); pc++; break;
      case 83:                                 // EXIT, low byte only
        if (!s.length) return [o, 2];
        return [o, s.pop() & 255];
      default: return [o, 5];                  // unknown opcode
    }
  }
}

function main() {
  const inDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (const id of fs.readdirSync(inDir).sort()) {
    const dir = path.join(inDir, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const pp = path.join(dir, 'program.bin'), ip = path.join(dir, 'input.bin');
    const prog = fs.existsSync(pp) ? fs.readFileSync(pp) : Buffer.alloc(0);
    const inp = fs.existsSync(ip) ? fs.readFileSync(ip) : Buffer.alloc(0);
    const [out, code] = run(prog, inp);
    const od = path.join(outDir, id);
    fs.mkdirSync(od, { recursive: true });
    fs.writeFileSync(path.join(od, 'stdout.bin'), Buffer.from(out));
    fs.writeFileSync(path.join(od, 'exit.txt'), code + '\n');
  }
}

main();
