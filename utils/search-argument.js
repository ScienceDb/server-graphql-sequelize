
const { Op } = require("sequelize");

/**
 * search Class to parse search argument for any model and translate it so sequelize model will accept it
 */
module.exports = class search{


  /**
   * constructor - Creates an instace with the given arguments
   *
   * @param  {string} field   field to filter.
   * @param  {string} value   value is the actual value to match in the filter. Must be defined.
   * @param  {string} valueType the expected value type (i.e. array, string)
   * @param  {string} operator operator used to perform the filter. Must be defined.
   * @param  {object} search  recursive search instance.
   * @return {object}          instace of search class.
   */
  constructor({field, value, valueType, operator, search}){
    this.field = field;
    this.value = this.constructor.parseValue(value, valueType);
    this.operator = operator;
    this.search = search
  }


  /**
   * @static parseValue - Creates the proper type(either array or string) of the value that user wants to filter.
   *
   * @param  {object} val value object to parse.
   * @return {(array|string|number)}     Parsed value
   */
  static parseValue(val, type){
    if(val !== undefined)
    {
      if(type === "Array")
      {
        return val.split(",");
      }else{
        return val;
      }
    }
  }


  /**
   * toSequelize - Convert recursive search instance to search object that sequelize will accept as input.
   *
   * @return {object}  Translated search instance into sequelize object format.
   */
  toSequelize(dataModelDefinition){
    let searchsInSequelize = {};

    if((this.operator === undefined || (this.value === undefined && this.search === undefined))){
      //there's no search-operation arguments
      return searchsInSequelize;

    } else if(this.search === undefined && this.field === undefined){
      searchsInSequelize[Op[this.operator]] = this.value;

    } else if(this.search === undefined){
      const strType = ['String', 'Time', 'DateTime', 'Date']
      let arrayType = (dataModelDefinition[this.field]!=undefined && dataModelDefinition[this.field].replace(/\s+/g, '')[0]==='[')
      if ( arrayType && this.operator === 'in'){
        let pattern = null
        if (strType.includes(dataModelDefinition[this.field].replace(/\s+/g, '').slice(1, -1))){
          this.value = '"'+this.value+'"' 
        } 
        pattern = [ '['+this.value+',%', '%,'+this.value+',%', '%,'+this.value+']'].map((item) => {
            return {[Op.like] : item};
          }); 
        pattern.push({[Op.eq] : '['+this.value+']'})       
        searchsInSequelize[this.field] = {
          [Op.or] : pattern
        };
      } else if (arrayType && this.operator === 'notIn'){
        let pattern = null
        if (strType.includes(dataModelDefinition[this.field].replace(/\s+/g, '').slice(1, -1))){
          this.value = '"'+this.value+'"' 
        } 
        pattern = [ '['+this.value+',%', '%,'+this.value+',%', '%,'+this.value+']'].map((item) => {
          return {[Op.notLike] : item};
        }); 
        pattern.push({[Op.ne] : '['+this.value+']'})
        searchsInSequelize[this.field] = {
          [Op.and] : pattern
        };
      } else {
        searchsInSequelize[this.field] = {
          [Op[this.operator]] : this.value
        };
      }

    }else if(this.field === undefined){
      searchsInSequelize[Op[this.operator]] = this.search.map(sa => {
        let new_sa = new search(sa);
        return new_sa.toSequelize(dataModelDefinition);
      });

    }else{
       searchsInSequelize[this.field] = {
         [Op[this.operator]] : this.search.map(sa => {
           let new_sa = new search(sa);
           return new_sa.toSequelize(dataModelDefinition);
         })
       }
    }

    return searchsInSequelize;
  }
  /**
   * 
   * @param {*} operatorString 
   */
  transformCassandraOperator(operatorString) {
    switch (operatorString) {
      case 'eq': return ' = ';
      case 'lt': return ' < ';
      case 'gt': return ' > ';
      case 'lte': return ' <= ';
      case 'gte': return ' >= ';
      case '_in': return ' IN ';
      case 'cont': return ' CONTAINS ';
      case 'ctk': return ' CONTAINS KEY ';
      // AND not supported here, because this.search is undefined if this is executed
      case 'and': throw new Error(`Operator 'and' can only be used with an array of search terms`);
      default: throw new Error(`Operator ${operatorString} not supported`);
    }
  }

  /**
   * toCassandra - Convert recursive search instance to search string for use in CQL
   * 
   * @param{string} idAttribute - The name of the ID attribute which isn't cast into apostrophes if it is a UUID
   * @param{boolean} allowFiltering - Set 'ALLOW FILTERING'
   * @param{Array<string> | undefined} stringAttributeArray - An array of the string attributes, if present
   * 
   * @returns{string} Translated search instance into CQL string
   */
  toCassandra(attributesDefinition, allowFiltering){
    let searchsInCassandra = '';
    let type = attributesDefinition[this.field];
    if((this.operator === undefined || (this.value === undefined && this.search === undefined))){
      //there's no search-operation arguments
      return searchsInCassandra;

    } else if(this.search === undefined && this.field === undefined) {
      searchsInCassandra = this.transformCassandraOperator(this.operator) + this.value;
      
    } else if (this.search === undefined && (this.operator === 'tlt' || this.operator === 'tgt')) {
      let op = (this.operator === 'tlt') ? '<' : '>';
      searchsInCassandra = `token(${this.field}) ${op} token('${this.value}')`;
    } else if(this.search === undefined) {
      let value = this.value;
      if(type === 'String' || type.includes('Date')){
        value = `'${this.value}'`;
      }
      searchsInCassandra = this.field + this.transformCassandraOperator(this.operator) + value;

    } else if (this.operator === 'and') {
      searchsInCassandra = this.search.map(singleSearch => new search(singleSearch).toCassandra()).join(' and ');
      
    } else {
      throw new Error('Statement not supported by CQL:\n' + JSON.stringify(this, null, 2));
    }

    if (allowFiltering) {
      searchsInCassandra += ' ALLOW FILTERING';
    }

    return searchsInCassandra;
  }
};
