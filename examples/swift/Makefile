build:
	# Build the Swift Lambda function
	docker run \
		--rm \
		-v ./:/workspace \
		-w /workspace \
		swift:5.10-amazonlinux2 \
		bash -cl "swift build -c release --static-swift-stdlib"
	# Copy the binary to the lambda directory
	mkdir -p .build/lambda/app
	cp .build/release/app .build/lambda/app/bootstrap
