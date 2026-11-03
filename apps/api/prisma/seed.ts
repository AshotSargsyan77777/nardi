/**
 * Idempotent bootstrap data: the two currencies and (inactive) example coin packages.
 * No users, balances or payments are created here. Packages stay inactive until the owner
 * reviews prices in the admin panel and enables purchases.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.currency.upsert({
    where: { code: 'BLOT' },
    create: { code: 'BLOT', name: 'BLOT COINS', symbol: 'BC', purchasable: false, redeemable: false },
    update: {},
  });
  await prisma.currency.upsert({
    where: { code: 'FUN' },
    create: { code: 'FUN', name: 'Practice chips', symbol: 'FC', purchasable: false, redeemable: false },
    update: {},
  });
  if ((await prisma.coinPackage.count()) === 0) {
    const examples = [
      { name: 'Starter', coins: 100n, bonusCoins: 0n, sortOrder: 1 },
      { name: 'Player', coins: 500n, bonusCoins: 25n, sortOrder: 2 },
      { name: 'Pro', coins: 1000n, bonusCoins: 100n, sortOrder: 3 },
      { name: 'Champion', coins: 5000n, bonusCoins: 750n, sortOrder: 4 },
    ];
    // Prices are intentionally NOT set: they come from the admin-defined rate or a fixed price.
    for (const p of examples) await prisma.coinPackage.create({ data: { ...p, fiatCurrency: 'AMD', active: false } });
  }
  console.log('Seed complete: currencies BLOT/FUN, example packages (inactive).');
}

main().finally(() => prisma.$disconnect());
