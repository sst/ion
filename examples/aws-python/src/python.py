from dateutil.parser import parse
from sst_sdk import Resource
import os

from sst import Resource as SSTResource


def handler(event, context):
    print("Function invoked from Python")
    today = "2024-08-24"
    date = parse(today)
    # print(f"Date: {date}")
    # # print all os environment variables that start with "SST_"
    # for key, value in os.environ.items():
    #     if key.startswith("SST_"):
    #         print(f"{key}: {value}")
    # print(Resource._raw)
    # print(Resource.MyLinkableValue.value)

    print(f"Sst Resource: {SSTResource.MyLinkableValue.foo}")

    return {
        "statusCode": 200,
        "body": f"Hello World from Python!!!!!! - {date}",
    }
