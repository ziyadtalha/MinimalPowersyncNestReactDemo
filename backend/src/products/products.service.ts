import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) { }

  async create(user: { id: string }, dto: CreateProductDto) {
    const product = await this.prisma.product.create({
      data: {
        name: dto.name,
        price: dto.price,
        description: dto.description,
        ownerId: user.id,
      },
    });
    return product;
  }

  async findAll(user: { id: string; role?: string }) {
    if (user.role === 'ADMIN') {
      return this.prisma.product.findMany();
    }
    return this.prisma.product.findMany({ where: { ownerId: user.id } });
  }

  async findOne(user: { id: string; role?: string }, id: string) {
    const where = user.role === 'ADMIN' ? { id } : { id, ownerId: user.id };
    const product = await this.prisma.product.findFirst({ where });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(user: { id: string }, id: string, dto: UpdateProductDto) {
    const result = await this.prisma.product.updateMany({
      where: { id, ownerId: user.id },
      data: dto as any,
    });
    if (result.count === 0)
      throw new NotFoundException('Product not found or not owner');
    return this.prisma.product.findUnique({ where: { id } });
  }

  async remove(user: { id: string }, id: string) {
    const result = await this.prisma.product.deleteMany({
      where: { id, ownerId: user.id },
    });
    if (result.count === 0)
      throw new NotFoundException('Product not found or not owner');
    return { deleted: true };
  }
}
