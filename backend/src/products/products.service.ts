import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) { }

  async create(userId: string, dto: CreateProductDto) {
    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        price: dto.price,
        description: dto.description,
        ownerId: userId,
      },
    });
    return product;
  }

  async findAll(userId: string) {
    return this.prisma.product.findMany({ where: { ownerId: userId } });
  }

  async findOne(userId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, ownerId: userId },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(userId: string, id: string, dto: UpdateProductDto) {
    const result = await this.prisma.product.updateMany({
      where: { id, ownerId: userId },
      data: dto as any,
    });
    if (result.count === 0)
      throw new NotFoundException('Product not found or not owner');
    return this.prisma.product.findUnique({ where: { id } });
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.product.deleteMany({
      where: { id, ownerId: userId },
    });
    if (result.count === 0)
      throw new NotFoundException('Product not found or not owner');
    return { deleted: true };
  }
}
