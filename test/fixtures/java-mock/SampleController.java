package com.example.mock;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.client.RestTemplate;

@RestController
@RequestMapping("/api/v1/mock")
public class SampleController {
    
    private final RestTemplate restTemplate;

    public SampleController(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }
    
    @GetMapping("/users")
    public String getUsers() {
        return restTemplate.getForObject("http://api.external.com/users", String.class);
    }
}
