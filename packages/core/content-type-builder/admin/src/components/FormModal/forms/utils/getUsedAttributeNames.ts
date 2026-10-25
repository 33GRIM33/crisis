import snakeCase from 'lodash/snakeCase';

export type SchemaData = {
  initialData: {
    name?: string;
    targetAttribute?: string | null;
    [key: string]: unknown;
  };
  modifiedData: {
    createComponent?: boolean;
    enum?: string[];
    name?: string;
    relation?: string;
    repeatable?: boolean;
    targetAttribute?: string | null;
    targetField?: string;
    type?: string;
    [key: string]: unknown;
  };
};

export type Attribute = {
  name: string;
};

export const getUsedAttributeNames = (
  attributes: Array<Attribute>,
  schemaData: SchemaData
): Array<string> => {
  const editedNames = [schemaData.initialData.name, schemaData.modifiedData.name]
    .filter((name): name is string => Boolean(name))
    .map((name) => snakeCase(name));

  const isEditedAttribute = (name: string) => editedNames.includes(snakeCase(name));

  return attributes.filter(({ name }) => !isEditedAttribute(name)).map(({ name }) => name);
};
