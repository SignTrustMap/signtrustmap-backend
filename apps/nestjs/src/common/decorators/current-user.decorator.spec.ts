import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';

function getParamDecoratorFactory(decorator: Function) {
  class TestClass {
    testMethod(@decorator() value: any) {
      return value;
    }
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestClass, 'testMethod');
  return args[Object.keys(args)[0]].factory;
}

describe('CurrentUser Decorator', () => {
  it('extracts request.user from execution context', () => {
    const factory = getParamDecoratorFactory(CurrentUser);
    const mockUser = { id: 'u-1', email: 'driver@test.dev', roles: ['DRIVER'] };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: mockUser }),
      }),
    };

    const result = factory(null, ctx as any);
    expect(result).toEqual(mockUser);
  });
});
