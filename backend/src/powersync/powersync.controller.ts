import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('powersync')
@Controller('powersync')
export class PowersyncController {
  // Returns the minimal payload powersync expects for auth: { user_id, allowed_tables }
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('auth')
  @ApiOperation({ summary: 'Powersync auth endpoint' })
  @ApiResponse({ status: 200, description: 'Powersync auth response' })
  auth(@CurrentUser() user: { id: string }) {
    return {
      user_id: user.id,
    };
  }
}
