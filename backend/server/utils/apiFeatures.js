class ApiFeatures {
  constructor(mongooseQuery, queryString) {
    this.mongooseQuery = mongooseQuery;
    this.queryString = queryString;
    // console.log('queryString', typeof mongooseQuery);
  }

  filter(query = {}) {
    const queryStringObj = { ...this.queryString };
    // delete i wnat use in this filteration
    const excludesFields = ['limit', 'page', 'fields', 'sort', 'keyword', 'lang', 'mainCategoryId', 'subCateogries', 'sizes'];

    excludesFields.forEach(field => {
      delete queryStringObj[field];
    });

    let queryStr = JSON.stringify(queryStringObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, match => `$${match}`);

    const queryStrParse = JSON.parse(queryStr);
    const queryLen = Object.keys(query).length;

    // console.log(query);
    // const parsedQuery=queryLen?query: queryStrParse;
    const parsedQuery = {
      ...query,
      ...queryStrParse,
    };

    for (const key in parsedQuery) {
      if (key.startsWith('$') && !['$gte', '$gt', '$lte', '$lt'].includes(key)) {
        throw new Error(`Invalid field name: ${key}`);
      }
    }

    // filteration of routes
    this.mongooseQuery = this.mongooseQuery.find(parsedQuery);

    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.mongooseQuery = this.mongooseQuery.sort(sortBy);
    } else {
      this.mongooseQuery = this.mongooseQuery.sort('-createdAt');
    }
    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.mongooseQuery = this.mongooseQuery.select(fields);
    } else this.mongooseQuery = this.mongooseQuery.select('-__v');
    return this;
  }

  search(modelName) {
    const lang = this.queryString.lang;

    if (this.queryString.keyword) {
      let query = {};
      if (modelName === 'Products') {
        query.$or = [
          {
            [`title.${lang}`]: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },
          {
            [`description.${lang}`]: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },
        ];
      } else {
        query.$or = [
          {
            [`name.${lang}`]: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },
          // find by name in all lang
          {
            ['name']: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },

          {
            ['phone']: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },

          // find by email in all lang
          {
            ['email']: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },
          // find by email vendor
          {
            ['contact.email']: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },

          // find by phone in all lang
          {
            ['contact.phone']: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },
        ];
      }

      this.mongooseQuery = this.mongooseQuery.find(query);
    }
    return this;
  }

  //

  // paginate(countDocuments) {
  //   const page = this.queryString.page || 1;
  //   const limit = this.queryString.limit || 50;
  //   const skip = (page - 1) * limit;
  //   const endIndex = page * limit;

  //   // Pagination result
  //   const pagination = {};
  //   pagination.currentPage = page;
  //   pagination.limit = limit;
  //   pagination.numberOfPages = Math.ceil(countDocuments / limit);

  //   // Next page
  //   if (endIndex < countDocuments) {
  //     pagination.next = page + 1;
  //   }

  //   if (skip) {
  //        pagination.prev = page - 1;
  //   }

  //   this.paginationResult = pagination;
  //   this.mongooseQuery = this.mongooseQuery.skip(skip).limit(limit);
  //   return this;
  // }

  paginate(countDocuments) {
    const page = this.queryString.page * 1 || 1; // Convert to number
    const limit = this.queryString.limit * 1 || 50;
    const skip = (page - 1) * limit;
    const endIndex = page * limit;

    // Pagination result
    const pagination = {};
    pagination.currentPage = page;
    pagination.limit = limit;
    pagination.numberOfPages = Math.ceil(countDocuments / limit);

    // Next page
    if (endIndex < countDocuments) {
      pagination.next = page + 1;
    }

    // Previous page
    if (skip > 0) {
      pagination.prev = page - 1;
    }

    this.paginationResult = pagination;

    // Ensure mongooseQuery is a Mongoose query object
    if (this.mongooseQuery && typeof this.mongooseQuery.skip === 'function' && typeof this.mongooseQuery.limit === 'function') {
      this.mongooseQuery = this.mongooseQuery.skip(skip).limit(limit);
    } else {
      throw new Error('mongooseQuery is not a valid Mongoose query object');
    }

    return this;
  }

  populate(populateOpt) {
    this.mongooseQuery = this.mongooseQuery.populate(populateOpt);
    return this;
  }
}

class Feathures {
  constructor(mongooseQuery, queryString) {
    this.mongooseQuery = mongooseQuery;
    this.queryString = queryString;
  }

  filter() {
    const queryObj = { ...this.queryString };
    const excludeFields = ['limit', 'page', 'fields', 'sort', 'keyword', 'lang'];
    excludeFields.forEach(el => delete queryObj[el]);
    let queryStr = JSON.stringify(queryObj);
    queryStr = queryStr.replace(/\b(gte|gt|lte|lt)\b/g, match => `$${match}`);
    this.mongooseQuery = this.mongooseQuery.find(JSON.parse(queryStr));
    return this;
  }

  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.mongooseQuery = this.mongooseQuery.sort(sortBy);
    } else {
      this.mongooseQuery = this.mongooseQuery.sort('-createdAt');
    }
    return this;
  }

  limitFields() {
    if (this.queryString.fields) {
      const fields = this.queryString.fields.split(',').join(' ');
      this.mongooseQuery = this.mongooseQuery.select(fields);
    } else {
      this.mongooseQuery = this.mongooseQuery.select('-__v');
    }
    return this;
  }

  search(modelName) {
    const lang = this.queryString.lang;
    if (this.queryString.keyword) {
      let query = {};
      if (modelName === 'Products') {
        query.$or = [
          {
            [`title.${lang}`]: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },
          {
            [`description.${lang}`]: {
              $regex: this.queryString.keyword,
              $options: 'i',
            },
          },
        ];
      } else {
        query = {
          [`name.${lang}`]: {
            $regex: this.queryString.keyword,
            $options: 'i',
          },
        };
      }
      this.mongooseQuery = this.mongooseQuery.find(query);
    }
    return this;
  }
}

module.exports = ApiFeatures;
