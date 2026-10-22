/**
 * One-time bootstrap of the first administrator.
 *
 *   npm run create-admin -- --email admin@school.edu --name "Jane Admin"
 *
 * Credentials come from CLI flags / environment variables (INITIAL_ADMIN_EMAIL, INITIAL_ADMIN_NAME,
 * INITIAL_ADMIN_PASSWORD) or an interactive hidden prompt — never from source code.
 *
 * Reuse protection: once any administrator exists the command refuses to run. Additional admins are
 * created in the admin panel (Users → change role), which is authenticated, authorised and audited.
 * Emergency recovery of a locked-out installation requires an explicit flag and an existing admin email:
 *
 *   npm run create-admin -- --recover --email existing-admin@school.edu
 *
 * which resets that admin's password, re-activates it and revokes its sessions (audited as ADMIN_RECOVERED).
 */
import bcrypt from 'bcryptjs';
import readline from 'node:readline';
import { prisma } from '../lib/prisma.js';
import { email as emailSchema, password as passwordSchema, personName } from '../schemas/common.js';

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted || s.includes('\n')) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword() {
  let pwd = process.env.INITIAL_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (!pwd) {
    if (!process.stdin.isTTY) throw new Error('No TTY available: set INITIAL_ADMIN_PASSWORD for non-interactive use.');
    pwd = await promptHidden('Admin password: ');
    const confirm = await promptHidden('Confirm password: ');
    if (pwd !== confirm) throw new Error('Passwords do not match');
  }
  return bcrypt.hash(passwordSchema.parse(pwd), 12);
}

async function main() {
  const email = emailSchema.parse(arg('email') ?? process.env.INITIAL_ADMIN_EMAIL);
  const recover = flag('recover');

  if (recover) {
    const admin = await prisma.user.findUnique({ where: { email } });
    if (!admin || admin.role !== 'ADMIN' || admin.deletedAt) throw new Error('Recovery requires the email of an existing administrator.');
    const passwordHash = await readPassword();
    await prisma.$transaction([
      prisma.user.update({ where: { id: admin.id }, data: { passwordHash, status: 'ACTIVE', tokenVersion: { increment: 1 } } }),
      prisma.auditLog.create({ data: { action: 'ADMIN_RECOVERED', entityType: 'User', entityId: admin.id, actorEmail: 'cli', metadata: { email, via: 'cli' } } }),
    ]);
    console.info(`Administrator recovered: ${email}. All previous sessions were revoked.`);
    return;
  }

  const name = personName.parse(arg('name') ?? process.env.INITIAL_ADMIN_NAME ?? 'Administrator');
  const passwordHash = await readPassword();

  // The existence check and the insert run in one serializable transaction, so two concurrent
  // bootstrap runs cannot both succeed.
  const user = await prisma.$transaction(
    async (tx) => {
      const existingAdmins = await tx.user.count({ where: { role: 'ADMIN' } });
      if (existingAdmins > 0) {
        throw new Error(
          'An administrator already exists, so bootstrap is disabled. Grant admin rights from the admin panel, ' +
            'or use --recover with an existing admin email if you are locked out.',
        );
      }
      if (await tx.user.findUnique({ where: { email } })) throw new Error(`An account with ${email} already exists.`);
      const created = await tx.user.create({ data: { email, name, passwordHash, role: 'ADMIN', status: 'ACTIVE' } });
      await tx.auditLog.create({
        data: { action: 'ADMIN_BOOTSTRAPPED', entityType: 'User', entityId: created.id, actorEmail: 'cli', metadata: { email, via: 'cli' } },
      });
      return created;
    },
    { isolationLevel: 'Serializable' },
  );
  console.info(`First administrator created: ${user.email}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
