import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    try {
      const connectionString = process.env.DATABASE_URL || '';
      const pool = new Pool({ connectionString });
      const adapter = new PrismaPg(pool);

      super({ adapter });
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.error('Failed to initialize Prisma adapter:', err.message);
        throw err;
      }
      console.error('Failed to initialize Prisma adapter:', String(err));
      throw new Error(String(err));
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
