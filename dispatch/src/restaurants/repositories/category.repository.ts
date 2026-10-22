import {Injectable} from '@nestjs/common';
import {DataSource, Repository} from 'typeorm';

import {Category} from '../entities/category.entity';

/**
 * TypeORM 0.3 removed the @EntityRepository decorator, and @nestjs/typeorm no
 * longer resolves custom repositories passed to TypeOrmModule.forFeature().
 * The supported replacement is a plain provider that builds itself from the
 * DataSource; extending Repository keeps every existing call site (find,
 * findOne, save) working unchanged.
 */
@Injectable()
export class CategoryRepository extends Repository<Category> {
  constructor(dataSource: DataSource) {
    super(Category, dataSource.createEntityManager());
  }

  async getOrCreate(name: string): Promise<Category> {
    const categoryName = name.trim().toLowerCase();
    const categorySlug = categoryName.replace(/ /g, '-');
    let category = await this.findOne({where: {slug: categorySlug}});
    if (!category) {
      category = await this.save(this.create({name: categoryName, slug: categorySlug}));
    }
    return category;
  }
}
