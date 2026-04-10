// 這裡改成了引入 2020 版的解析器
import Ajv from 'ajv/dist/2020.js'; 
import addFormats from 'ajv-formats';
import { readJson } from './io.js';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export async function validateAgainstSchema(schemaPath, data) {
  const schema = await readJson(schemaPath);
  const validate = ajv.compile(schema);
  const valid = validate(data);
  return { valid, errors: validate.errors || [] };
}