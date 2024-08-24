import importlib
import io
import json
import os
import sys
import traceback
import time
import requests


# Error handling function to report errors back to the Lambda runtime API
def report_error(ex, context=None):
    error_response = {
        "errorType": "Error",
        "errorMessage": str(ex),
        "trace": traceback.format_exc().split("\n"),
    }

    endpoint = (
        f"{AWS_LAMBDA_RUNTIME_API}/runtime/init/error"
        if context is None
        else f"{AWS_LAMBDA_RUNTIME_API}/runtime/invocation/{context['awsRequestId']}/error"
    )
    requests.post(
        endpoint,
        headers={"Content-Type": "application/json"},
        data=json.dumps(error_response),
    )


# Parse the handler from command-line arguments
handler = sys.argv[1]  # Expecting the format 'module.function'
AWS_LAMBDA_RUNTIME_API = f"http://{os.environ['AWS_LAMBDA_RUNTIME_API']}"

# If the handler is given as a file path, split it to get the directory and module
module_path, function_name = handler.rsplit(".", 1)
module_dir = os.path.dirname(module_path)
module_name = os.path.basename(module_path)

# Add the directory containing the module to the system path
sys.path.insert(0, module_dir)

try:
    # Dynamically load the module from the file path
    spec = importlib.util.spec_from_file_location(module_name, module_path + ".py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    # Get the function from the module
    handler_function = getattr(module, function_name)
    if not callable(handler_function):
        raise ImportError(
            f"{function_name} is not a callable function in {module_name}"
        )
except Exception as ex:
    report_error(ex)
    sys.exit(1)

# Capture stdout and stderr
stdout_buffer = io.StringIO()
stderr_buffer = io.StringIO()
sys.stdout = stdout_buffer
sys.stderr = stderr_buffer

# Simulating Lambda's event loop
while True:
    try:
        # Get the next event to process
        response = requests.get(f"{AWS_LAMBDA_RUNTIME_API}/runtime/invocation/next")
        response.raise_for_status()

        context = {
            "awsRequestId": response.headers.get("Lambda-Runtime-Aws-Request-Id"),
            "invokedFunctionArn": response.headers.get(
                "Lambda-Runtime-Invoked-Function-Arn"
            ),
            "getRemainingTimeInMillis": lambda: max(
                int(response.headers.get("Lambda-Runtime-Deadline-Ms"))
                - int(time.time() * 1000),
                0,
            ),
            "functionName": os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
            "functionVersion": os.environ.get("AWS_LAMBDA_FUNCTION_VERSION"),
            "memoryLimitInMB": os.environ.get("AWS_LAMBDA_FUNCTION_MEMORY_SIZE"),
            "logGroupName": os.environ.get("AWS_LAMBDA_LOG_GROUP_NAME"),
            "logStreamName": os.environ.get("AWS_LAMBDA_LOG_STREAM_NAME"),
        }

        event = response.json()

    except Exception as ex:
        report_error(ex)
        continue

    # Run the handler function
    try:
        print(f"invoking handler {handler_function}")
        result = handler_function(event, context)
        print(f"handler returned {result}")
    except Exception as ex:
        report_error(ex, context)
        continue

    # Capture stdout and stderr output
    stdout = stdout_buffer.getvalue()
    stderr = stderr_buffer.getvalue()

    # Log stdout and stderr output
    print(stdout)
    print(stderr)

    # Send the response back to Lambda
    while True:
        try:
            requests.post(
                f"{AWS_LAMBDA_RUNTIME_API}/runtime/invocation/{context['awsRequestId']}/response",
                headers={"Content-Type": "application/json"},
                data=json.dumps(result),
            )
            break
        except Exception as _:
            time.sleep(0.5)
            continue

    # Clear the buffers for the next event
    stdout_buffer.truncate(0)
    stdout_buffer.seek(0)
    stderr_buffer.truncate(0)
    stderr_buffer.seek(0)
