from sst_sdk import Resource

from .sst import Resource as SSTResource


def handler(event, context):
    print("Function invoked from Python")

    return {
        "statusCode": 200,
        "body": f"{SSTResource.MyLinkableValue.foo} from Python!",
    }
