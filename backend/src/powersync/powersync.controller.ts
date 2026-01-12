import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PowerSyncService } from './powersync.service';

interface CrudOperation {
  op: 'PUT' | 'PATCH' | 'DELETE';
  type: string; // PowerSync uses 'type' for table name
  id: string;
  data?: Record<string, any>; // PowerSync uses 'data' for operation data
}

interface UploadTransactionDto {
  crud: CrudOperation[];
}

@Controller('powersync')
@UseGuards(JwtAuthGuard)
export class PowerSyncController {
  private readonly logger = new Logger(PowerSyncController.name);

  constructor(private readonly powerSyncService: PowerSyncService) {}

  /**
   * Endpoint for PowerSync clients to upload write operations
   * POST /powersync/upload
   */
  @Post('upload')
  async uploadCrudBatch(
    @CurrentUser() user: { id: string; email: string },
    @Body() transaction: UploadTransactionDto,
  ) {
    this.logger.log(
      `Received upload batch with ${transaction.crud.length} operations from user ${user.id}`,
    );

    // Log the full transaction structure for debugging
    this.logger.debug('Transaction structure:', JSON.stringify(transaction, null, 2));

    try {
      const result = await this.powerSyncService.processCrudBatch(
        user.id,
        transaction,
      );

      return result;
    } catch (error) {
      this.logger.error('Error processing upload batch:', error);
      // Re-throw to return 500 for transient errors (triggers client retry)
      throw error;
    }
  }
}
