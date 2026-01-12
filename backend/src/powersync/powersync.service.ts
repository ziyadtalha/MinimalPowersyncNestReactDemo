import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Fatal error codes that should not be retried
const FATAL_ERROR_CODES = [
  'P2002', // Unique constraint violation
  'P2003', // Foreign key constraint violation
  'P2025', // Record not found
];

interface CrudOperation {
  op: 'PUT' | 'PATCH' | 'DELETE';
  type: string; // PowerSync uses 'type' for table name
  id: string;
  data?: Record<string, any>; // PowerSync uses 'data' for operation data
}

interface UploadTransaction {
  crud: CrudOperation[];
}

@Injectable()
export class PowerSyncService {
  private readonly logger = new Logger(PowerSyncService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Process a batch of CRUD operations from the PowerSync client
   * Returns success status or throws appropriate errors for retry logic
   */
  async processCrudBatch(
    userId: string,
    transaction: UploadTransaction,
  ): Promise<{ success: boolean; processed: number }> {
    let processedCount = 0;

    try {
      // Execute all operations in a database transaction
      await this.prisma.$transaction(async (tx) => {
        for (const op of transaction.crud) {
          this.logger.debug(
            `Processing ${op.op} on ${op.type} (id: ${op.id}) for user ${userId}`,
          );

          try {
            await this.applyCrudOperation(tx, userId, op);
            processedCount++;
          } catch (error) {
            this.logger.error(
              `Error applying operation ${op.op} on ${op.type}:`,
              error,
            );
            throw error;
          }
        }
      });

      this.logger.log(
        `Successfully processed ${processedCount} operations for user ${userId}`,
      );
      return { success: true, processed: processedCount };
    } catch (error: any) {
      // Check if this is a fatal error (application/data error)
      const isFatal = this.isFatalError(error);

      if (isFatal) {
        this.logger.warn(
          `Fatal error processing transaction - discarding: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Return success to tell client to discard this transaction
        // In production, you might want to save these to a dead-letter queue
        return { success: true, processed: 0 };
      }

      // Transient error - throw to trigger retry
      this.logger.error('Transient error processing transaction:', error);
      throw error;
    }
  }

  /**
   * Apply a single CRUD operation
   */
  private async applyCrudOperation(
    tx: any,
    userId: string,
    op: CrudOperation,
  ): Promise<void> {
    const { type: table, id, data: opData } = op;

    // Map PowerSync table names to Prisma models (case-sensitive)
    const model = this.getPrismaModel(tx, table); // eslint-disable-line @typescript-eslint/no-unsafe-assignment

    if (!model) {
      throw new BadRequestException(`Unknown table: ${table}`);
    }

    switch (op.op) {
      case 'PUT':
        // PUT = upsert (insert or update)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        await model.upsert({
          where: { id },
          create: { id, ...opData, ownerId: userId },
          update: { ...opData },
        });
        break;

      case 'PATCH': {
        // PATCH = update only
        // Ensure user owns the record
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const updateResult = await model.updateMany({
          where: { id, ownerId: userId },
          data: opData,
        });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (updateResult.count === 0) {
          this.logger.warn(
            `PATCH failed: Record ${id} not found or not owned by user ${userId}`,
          );
          // This is a fatal error - record doesn't exist or user doesn't own it
          throw new BadRequestException(
            'Record not found or insufficient permissions',
          );
        }
        break;
      }

      case 'DELETE': {
        // DELETE = remove record
        // Ensure user owns the record
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const deleteResult = await model.deleteMany({
          where: { id, ownerId: userId },
        });

        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (deleteResult.count === 0) {
          this.logger.warn(
            `DELETE failed: Record ${id} not found or not owned by user ${userId}`,
          );
          // Treat as success - idempotent delete
        }
        break;
      }

      default:
        throw new BadRequestException('Unknown operation');
    }
  }

  /**
   * Get the Prisma model for a table name
   */
  private getPrismaModel(tx: any, tableName: string): any {
    // Map PowerSync table names to Prisma model names
    const modelMap: Record<string, string> = {
      Product: 'product',
      // Add more table mappings as needed
    };

    const modelName = modelMap[tableName];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    return modelName ? tx[modelName] : null;
  }

  /**
   * Determine if an error is fatal (should not be retried)
   */
  private isFatalError(error: unknown): boolean {
    // Check Prisma error codes
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === 'string' && FATAL_ERROR_CODES.includes(code)) {
        return true;
      }
    }

    // Check for validation errors
    if (error instanceof BadRequestException) {
      return true;
    }

    // Check for Prisma validation errors (e.g., invalid date format)
    if (typeof error === 'object' && error !== null && 'name' in error) {
      const errorName = (error as { name: unknown }).name;
      if (errorName === 'ValidationError' || errorName === 'PrismaClientValidationError') {
        return true;
      }
    }

    // All other errors are considered transient (network, DB deadlock, etc.)
    return false;
  }
}
