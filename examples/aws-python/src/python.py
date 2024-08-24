import sys

from dateutil.parser import parse


def handler(event, context):
    print("Function invoked from Python")
    sys.stderr.write("This is a test error log.\n")
    sys.stderr.flush()
    sys.stdout.write("This is a test stdout log.\n")
    sys.stdout.flush()

    today = "2024-08-24"

    date = parse(today)
    print(date)
    print(f"Date: {date}")
    return {
        "statusCode": 200,
        "body": f"Hello World from Python!!!!!! - {date}",
    }
