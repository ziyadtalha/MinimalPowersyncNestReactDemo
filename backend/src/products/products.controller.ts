import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create product' })
  async create(
    @CurrentUser() user: { id: string },
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(user.id, dto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get user's products" })
  async findAll(@CurrentUser() user: { id: string }) {
    return this.productsService.findAll(user.id);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get product by id (must be owner)' })
  async findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.productsService.findOne(user.id, id);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update product (owner only)' })
  async update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete product (owner only)' })
  async remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.productsService.remove(user.id, id);
  }
}
